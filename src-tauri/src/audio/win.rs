//! Audio capture with WASAPI.
//!
//! Three modes, all through the same path (`IAudioCaptureClient` read in a loop
//! from a dedicated thread):
//!
//! * **Microphone** — a plain `IAudioClient` over a capture endpoint.
//! * **System audio** — the default render endpoint with
//!   `AUDCLNT_STREAMFLAGS_LOOPBACK`.
//! * **Per application** — `ActivateAudioInterfaceAsync` with
//!   `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` (Windows 10 2004 / build
//!   19041 and later).
//!
//! Reading is done by polling every few milliseconds rather than with an event:
//! loopback mode does not accept `AUDCLNT_STREAMFLAGS_EVENTCALLBACK`, so polling
//! keeps a single loop valid for all three modes.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use windows::core::{implement, Interface, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, RPC_E_CHANGED_MODE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    AudioSessionStateExpired, IAudioCaptureClient, IAudioClient, IAudioSessionControl2,
    IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, DEVICE_STATE_ACTIVE,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::Threading::{
    CreateEventW, OpenProcess, QueryFullProcessImageNameW, SetEvent, WaitForSingleObject,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

/// `windows` 0.58 does not export this constant under `Win32::Media::Audio`.
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
/// VT_BLOB, for the PROPVARIANT carrying the activation parameters.
const VT_BLOB_TAG: u16 = 65;

use crate::dsp;
use crate::errors;
use crate::model::AudioSource;

/// Sample rate and format the WAV is written with: mono 16 kHz, which is what
/// whisper consumes and plenty for speech. Avoids storing the original and
/// resampling afterwards.
pub const OUT_RATE: u32 = 16_000;
const LEVEL_BANDS: usize = 24;
const POLL: Duration = Duration::from_millis(10);
/// Drift tolerated before padding with silence: 200 ms, well above the buffer
/// latency and well below what is noticeable when jumping to a note.
const SILENCE_SLACK: u64 = (OUT_RATE / 5) as u64;

/// PKEY_Device_FriendlyName; the generated constant sits behind a feature that
/// is not always enabled, so it is declared here.
const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
    fmtid: windows::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 14,
};

/// Identifier of the virtual endpoint used by per-process loopback.
const VIRTUAL_LOOPBACK_DEVICE: PCWSTR = windows::core::w!("VAD\\Process_Loopback");

/// What to capture, resolved from the id the frontend sends.
pub enum SourceSpec {
    /// A specific capture endpoint (WASAPI device id).
    Microphone(String),
    /// The default render endpoint, in loopback mode.
    System,
    /// The process tree of a PID.
    Process(u32),
}

impl SourceSpec {
    pub fn parse(id: &str) -> Result<Self, String> {
        match id.split_once(':') {
            Some(("mic", rest)) => Ok(Self::Microphone(rest.to_string())),
            Some(("sys", _)) => Ok(Self::System),
            Some(("app", pid)) => pid
                .parse::<u32>()
                .map(Self::Process)
                .map_err(|_| errors::with(errors::AUDIO_UNKNOWN_SOURCE, id)),
            _ => Err(errors::with(errors::AUDIO_UNKNOWN_SOURCE, id)),
        }
    }
}

/// Wrapper so COM is initialised and torn down per thread.
struct ComGuard {
    /// `CoUninitialize` is only called if this guard did the initialising.
    owned: bool,
}

impl ComGuard {
    fn new() -> Result<Self, String> {
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if hr.is_ok() {
            return Ok(Self { owned: true });
        }
        // The thread is already in a different apartment (Tauri's main thread is
        // STA). Not a failure: COM can be used as-is, but tearing it down is not
        // ours to do.
        if hr == RPC_E_CHANGED_MODE {
            return Ok(Self { owned: false });
        }
        Err(errors::with(errors::AUDIO_COM, format!("{hr:?}")))
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.owned {
            unsafe { CoUninitialize() };
        }
    }
}

/// Runs `f` on a dedicated thread with COM in MTA.
///
/// Tauri commands run on threads whose apartment we do not control; WASAPI wants
/// MTA, so each operation is isolated on its own thread instead of depending on
/// however the calling thread happened to be initialised.
fn with_mta<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    std::thread::spawn(move || {
        let _com = ComGuard::new()?;
        f()
    })
    .join()
    .map_err(|_| errors::AUDIO_THREAD_CRASHED.to_string())?
}

// --------------------------------------------------------------- enumeration

pub fn list_sources() -> Result<Vec<AudioSource>, String> {
    with_mta(enumerate)
}

fn enumerate() -> Result<Vec<AudioSource>, String> {
    let mut out = Vec::new();

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| errors::with(errors::AUDIO_ENUMERATE, e))?;

        // --- Inputs (microphones)
        let devices = enumerator
            .EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)
            .map_err(|e| errors::with(errors::AUDIO_ENUMERATE, e))?;
        for i in 0..devices.GetCount().unwrap_or(0) {
            let Ok(device) = devices.Item(i) else { continue };
            let Ok(id) = device.GetId() else { continue };
            let id_string = id.to_string().unwrap_or_default();
            CoTaskMemFree(Some(id.0 as *const _));
            if id_string.is_empty() {
                continue;
            }

            // Device names come from the OS and are shown verbatim; only this
            // last-resort fallback is ours, and it is rare enough to leave in
            // English rather than route a translation through the backend.
            let name = device
                .OpenPropertyStore(STGM_READ)
                .ok()
                .and_then(|store| store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME).ok())
                .map(|v| v.to_string())
                .unwrap_or_else(|| "Microphone".to_string());

            out.push(AudioSource {
                id: format!("mic:{id_string}"),
                label: name,
                group: "input".to_string(),
            });
        }

        // --- System audio. The label is a fallback: the frontend recognises
        // this id and translates it, since it is the one source we name.
        out.push(AudioSource {
            id: "sys:default".to_string(),
            label: "System audio (everything)".to_string(),
            group: "system".to_string(),
        });

        // --- Applications with an active audio session
        if let Ok(render) = enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
            if let Ok(manager) = render.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) {
                if let Ok(sessions) = manager.GetSessionEnumerator() {
                    let mut seen: Vec<u32> = Vec::new();
                    for i in 0..sessions.GetCount().unwrap_or(0) {
                        let Ok(control) = sessions.GetSession(i) else { continue };
                        let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
                        // Expired sessions belong to processes that already died.
                        let expired = control
                            .GetState()
                            .map(|s| s == AudioSessionStateExpired)
                            .unwrap_or(true);
                        if expired {
                            continue;
                        }
                        let Ok(pid) = control2.GetProcessId() else { continue };
                        // pid 0 is the system sounds session.
                        if pid == 0 || seen.contains(&pid) {
                            continue;
                        }
                        seen.push(pid);
                        if let Some(name) = process_name(pid) {
                            out.push(AudioSource {
                                id: format!("app:{pid}"),
                                label: name,
                                group: "apps".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(out)
}

/// Readable name of a process from its PID.
fn process_name(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 260];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(handle);
        ok.ok()?;

        let full = String::from_utf16_lossy(&buf[..len as usize]);
        let file = full.rsplit(['\\', '/']).next()?.to_string();
        // "Zoom.exe" -> "Zoom"
        Some(file.strip_suffix(".exe").unwrap_or(&file).to_string())
    }
}

// ------------------------------------------------------------------- capture

/// Destination for batches of levels. Injected so the capture does not depend
/// on Tauri and can be exercised from a test.
pub type LevelSink = Box<dyn Fn(Vec<f32>) + Send + 'static>;

pub struct CaptureHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<Result<(), String>>>,
    pub path: PathBuf,
    pub started: Instant,
}

impl CaptureHandle {
    /// Stops the capture thread and waits for it to close the WAV.
    pub fn stop(mut self) -> Result<(), String> {
        self.stop.store(true, Ordering::SeqCst);
        match self.join.take() {
            Some(join) => join
                .join()
                .map_err(|_| errors::AUDIO_THREAD_CRASHED.to_string())?,
            None => Ok(()),
        }
    }
}

pub fn start(
    source: SourceSpec,
    path: PathBuf,
    on_levels: LevelSink,
) -> Result<CaptureHandle, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let path_thread = path.clone();

    // Startup happens inside the thread (COM is per thread), but the result of
    // the initialisation has to come back here so `start_recording` itself can
    // fail rather than failing silently.
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();

    let join =
        thread::spawn(move || capture_thread(source, path_thread, on_levels, stop_thread, tx));

    match rx.recv() {
        Ok(Ok(())) => Ok(CaptureHandle {
            stop,
            join: Some(join),
            path,
            started: Instant::now(),
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(errors::AUDIO_THREAD_START.to_string()),
    }
}

fn capture_thread(
    source: SourceSpec,
    path: PathBuf,
    on_levels: LevelSink,
    stop: Arc<AtomicBool>,
    ready: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    let _com = match ComGuard::new() {
        Ok(guard) => guard,
        Err(e) => {
            let _ = ready.send(Err(e.clone()));
            return Err(e);
        }
    };

    let setup = (|| -> Result<_, String> {
        let (client, format) = open_client(&source)?;
        let capture: IAudioCaptureClient = unsafe { client.GetService() }
            .map_err(|e| errors::with(errors::AUDIO_START_CAPTURE, e))?;
        unsafe { client.Start() }.map_err(|e| errors::with(errors::AUDIO_START_CAPTURE, e))?;

        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: OUT_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let writer = hound::WavWriter::create(&path, spec)
            .map_err(|e| errors::with(errors::AUDIO_CREATE_FILE, e))?;
        Ok((client, capture, format, writer))
    })();

    let (client, capture, format, mut writer) = match setup {
        Ok(parts) => {
            let _ = ready.send(Ok(()));
            parts
        }
        Err(e) => {
            let _ = ready.send(Err(e.clone()));
            return Err(e);
        }
    };

    let mut pending: Vec<f32> = Vec::new();
    let mut result = Ok(());

    // In loopback, WASAPI delivers no packets while nothing is playing: the
    // silences simply do not exist in the stream. Without compensating for
    // them, the WAV comes out shorter than the meeting and the timestamps stop
    // matching the notes, which is exactly what the app promises. So the thread
    // keeps its own clock and pads the gaps with silence.
    let clock = Instant::now();
    let mut written: u64 = 0;

    while !stop.load(Ordering::SeqCst) {
        let mut drained_any = false;
        loop {
            let packet = match unsafe { capture.GetNextPacketSize() } {
                Ok(n) => n,
                Err(e) => {
                    result = Err(errors::with(errors::AUDIO_READ, e));
                    break;
                }
            };
            if packet == 0 {
                break;
            }
            drained_any = true;

            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames: u32 = 0;
            let mut flags: u32 = 0;
            if let Err(e) =
                unsafe { capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }
            {
                result = Err(errors::with(errors::AUDIO_READ, e));
                break;
            }

            let channels = format.channels as usize;
            let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
            let samples = if silent || data.is_null() {
                vec![0.0f32; frames as usize * channels]
            } else {
                read_samples(data, frames as usize, &format)
            };
            let _ = unsafe { capture.ReleaseBuffer(frames) };

            let mono = dsp::to_mono(&samples, channels);
            let resampled = dsp::resample(&mono, format.sample_rate, OUT_RATE);
            let write = resampled
                .iter()
                .try_for_each(|s| writer.write_sample(dsp::f32_to_i16(*s)));
            if let Err(e) = write {
                result = Err(errors::with(errors::AUDIO_WRITE, e));
                break;
            }
            written += resampled.len() as u64;
            pending.extend_from_slice(&resampled);
        }

        if result.is_err() {
            break;
        }

        // Pads the silence WASAPI did not deliver. The threshold lets normal
        // buffer latency through; only real gaps are compensated.
        let expected = (clock.elapsed().as_secs_f64() * OUT_RATE as f64) as u64;
        if expected > written + SILENCE_SLACK {
            let gap = expected - written;
            let fill = (0..gap).try_for_each(|_| writer.write_sample(0i16));
            if let Err(e) = fill {
                result = Err(errors::with(errors::AUDIO_WRITE, e));
                break;
            }
            written += gap;
        }

        // One batch of levels per ~100 ms of accumulated audio.
        if pending.len() >= (OUT_RATE as usize / 10) {
            on_levels(dsp::level_bands(&pending, LEVEL_BANDS));
            pending.clear();
        }

        if !drained_any {
            thread::sleep(POLL);
        }
    }

    let _ = unsafe { client.Stop() };
    if let Err(e) = writer.finalize() {
        if result.is_ok() {
            result = Err(errors::with(errors::AUDIO_CLOSE_FILE, e));
        }
    }
    // Leaves the bars at rest when it finishes.
    on_levels(vec![0.0f32; LEVEL_BANDS]);
    result
}

/// Capture format, already parsed, so the WAVEFORMATEX is not re-read in a loop.
#[derive(Clone, Copy)]
struct Format {
    channels: u16,
    sample_rate: u32,
    bits: u16,
    float: bool,
}

fn read_samples(data: *const u8, frames: usize, format: &Format) -> Vec<f32> {
    let count = frames * format.channels as usize;
    let mut out = Vec::with_capacity(count);
    unsafe {
        match (format.float, format.bits) {
            (true, 32) => {
                let p = data as *const f32;
                for i in 0..count {
                    out.push(*p.add(i));
                }
            }
            (false, 16) => {
                let p = data as *const i16;
                for i in 0..count {
                    out.push(*p.add(i) as f32 / i16::MAX as f32);
                }
            }
            (false, 32) => {
                let p = data as *const i32;
                for i in 0..count {
                    out.push(*p.add(i) as f32 / i32::MAX as f32);
                }
            }
            _ => out.resize(count, 0.0),
        }
    }
    out
}

fn parse_format(wf: *const WAVEFORMATEX) -> Result<Format, String> {
    if wf.is_null() {
        return Err(errors::AUDIO_DEVICE_FORMAT.to_string());
    }
    let f = unsafe { *wf };
    // In shared mode the format is usually WAVEFORMATEXTENSIBLE; the tag is
    // enough to tell float from PCM, and for the extensible case it is inferred
    // from the bit depth, which is the only thing that changes how the buffer is
    // read.
    let float = f.wFormatTag == WAVE_FORMAT_IEEE_FLOAT as u16
        || (f.wFormatTag != WAVE_FORMAT_PCM as u16 && f.wBitsPerSample == 32);
    Ok(Format {
        channels: f.nChannels,
        sample_rate: f.nSamplesPerSec,
        bits: f.wBitsPerSample,
        float,
    })
}

fn open_client(source: &SourceSpec) -> Result<(IAudioClient, Format), String> {
    match source {
        SourceSpec::Microphone(device_id) => unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| errors::with(errors::AUDIO_ENUMERATE, e))?;
            let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
            let device = enumerator
                .GetDevice(PCWSTR(wide.as_ptr()))
                .map_err(|e| errors::with(errors::AUDIO_OPEN_DEVICE, e))?;
            let client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| errors::with(errors::AUDIO_OPEN_DEVICE, e))?;
            let wf = client
                .GetMixFormat()
                .map_err(|e| errors::with(errors::AUDIO_DEVICE_FORMAT, e))?;
            let format = parse_format(wf)?;
            client
                .Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 10_000_000, 0, wf, None)
                .map_err(|e| errors::with(errors::AUDIO_START_CAPTURE, e))?;
            CoTaskMemFree(Some(wf as *const _));
            Ok((client, format))
        },

        SourceSpec::System => unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| errors::with(errors::AUDIO_ENUMERATE, e))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| errors::with(errors::AUDIO_OPEN_DEVICE, e))?;
            let client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| errors::with(errors::AUDIO_OPEN_DEVICE, e))?;
            let wf = client
                .GetMixFormat()
                .map_err(|e| errors::with(errors::AUDIO_DEVICE_FORMAT, e))?;
            let format = parse_format(wf)?;
            client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK,
                    10_000_000,
                    0,
                    wf,
                    None,
                )
                .map_err(|e| errors::with(errors::AUDIO_START_CAPTURE, e))?;
            CoTaskMemFree(Some(wf as *const _));
            Ok((client, format))
        },

        SourceSpec::Process(pid) => open_process_loopback(*pid),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    /// Checks against the machine's real WASAPI, not against a mock.
    #[test]
    fn enumerates_real_sources() {
        let sources = list_sources().expect("enumeration should work");
        for s in &sources {
            println!("[{}] {} -> {}", s.group, s.id, s.label);
        }
        assert!(
            sources.iter().any(|s| s.id == "sys:default"),
            "system audio must always be offered"
        );
        // Groups are contract keys the frontend translates, not labels.
        for s in &sources {
            assert!(
                matches!(s.group.as_str(), "input" | "system" | "apps"),
                "unknown group {}: the frontend would not translate it",
                s.group
            );
        }
        // Every emitted id has to parse back.
        for s in &sources {
            SourceSpec::parse(&s.id).unwrap_or_else(|e| panic!("unparseable id {}: {e}", s.id));
        }
    }

    /// Records from a source and returns (duration in seconds, peak amplitude).
    fn record(spec: SourceSpec, seconds: u64) -> (f64, f32) {
        let path = std::env::temp_dir().join(format!("cereales-test-{}.wav", std::process::id()));
        let _ = std::fs::remove_file(&path);

        let handle = start(spec, path.clone(), Box::new(|_| {})).expect("should start");
        thread::sleep(Duration::from_secs(seconds));
        handle.stop().expect("should close cleanly");

        let mut reader = hound::WavReader::open(&path).expect("readable WAV");
        let duration = reader.len() as f64 / OUT_RATE as f64;
        let peak = reader
            .samples::<i16>()
            .filter_map(|s| s.ok())
            .fold(0f32, |acc, s| acc.max((s as f32 / i16::MAX as f32).abs()));
        let _ = std::fs::remove_file(&path);
        (duration, peak)
    }

    /// The microphone uses a plain `IAudioClient`, a different path from loopback.
    #[test]
    fn captures_from_microphone() {
        let sources = list_sources().expect("enumeration");
        let Some(mic) = sources.iter().find(|s| s.group == "input") else {
            eprintln!("no microphone on this machine; test skipped");
            return;
        };
        let spec = SourceSpec::parse(&mic.id).expect("parseable id");
        let (duration, peak) = record(spec, 2);
        println!("microphone duration={duration:.2}s peak={peak:.4}");
        assert!(
            (duration - 2.0).abs() < 0.5,
            "the microphone drifts from the clock: {duration:.2}s"
        );
    }

    /// Per-process loopback is the path with async COM and the hand-built
    /// PROPVARIANT: this checks that it activates and captures without failing.
    #[test]
    fn captures_from_application() {
        let sources = list_sources().expect("enumeration");
        let Some(app) = sources.iter().find(|s| s.group == "apps") else {
            eprintln!("no app with an audio session; test skipped");
            return;
        };
        let spec = SourceSpec::parse(&app.id).expect("parseable id");
        let (duration, peak) = record(spec, 2);
        println!("app '{}' duration={duration:.2}s peak={peak:.4}", app.label);
        assert!(
            (duration - 2.0).abs() < 0.5,
            "per-app capture drifts from the clock: {duration:.2}s"
        );
    }

    /// Actually captures the system audio and checks that the duration of the
    /// WAV matches the real elapsed time.
    ///
    /// This is the property the whole app rests on: if the file comes out
    /// shorter than the meeting, the timestamped notes point at the wrong
    /// place. It holds even when nothing is playing, which is exactly when
    /// WASAPI delivers no packets.
    #[test]
    fn captured_duration_tracks_the_clock() {
        let path = std::env::temp_dir().join("cereales-test-capture.wav");
        let _ = std::fs::remove_file(&path);

        let batches = Arc::new(AtomicUsize::new(0));
        let counter = batches.clone();
        let handle = start(
            SourceSpec::System,
            path.clone(),
            Box::new(move |levels| {
                assert_eq!(levels.len(), LEVEL_BANDS);
                counter.fetch_add(1, Ordering::SeqCst);
            }),
        )
        .expect("system capture should start");

        let seconds = 3;
        thread::sleep(Duration::from_secs(seconds));
        handle.stop().expect("the capture should close cleanly");

        let reader = hound::WavReader::open(&path).expect("the WAV should be readable");
        let spec = reader.spec();
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.sample_rate, OUT_RATE);

        let samples = reader.len() as f64;
        let duration = samples / OUT_RATE as f64;
        println!(
            "duration={duration:.2}s samples={samples} level_batches={}",
            batches.load(Ordering::SeqCst)
        );
        let drift = (duration - seconds as f64).abs();
        assert!(
            drift < 0.5,
            "the audio drifts {drift:.2}s from the clock: the timestamps would not line up"
        );
        let _ = std::fs::remove_file(&path);
    }
}

/// Replica of the C layout of `PROPVARIANT` for the VT_BLOB case.
///
/// The `windows-core` type is opaque (it manages its own Drop) and offers no way
/// to build a blob, which is exactly what `ActivateAudioInterfaceAsync` wants.
#[repr(C)]
struct BlobPropVariant {
    vt: u16,
    r1: u16,
    r2: u16,
    r3: u16,
    cb_size: u32,
    /// The union aligns to 8 on 64-bit; on 32-bit the pointer sits right after.
    #[cfg(target_pointer_width = "64")]
    _pad: u32,
    p_blob: *mut u8,
}

// If this assert trips, the layout stopped matching and passing the pointer
// would be memory corruption rather than a visible error.
const _: () = assert!(
    std::mem::size_of::<BlobPropVariant>() == std::mem::size_of::<windows_core::PROPVARIANT>()
);

/// Completion handler required by `ActivateAudioInterfaceAsync`. It only signals
/// an event; the result is collected from the waiting thread.
#[implement(IActivateAudioInterfaceCompletionHandler)]
struct CompletionHandler {
    event: HANDLE,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for CompletionHandler_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Option<&IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        unsafe {
            let _ = SetEvent(self.event);
        }
        Ok(())
    }
}

fn open_process_loopback(pid: u32) -> Result<(IAudioClient, Format), String> {
    // Per-process loopback does not negotiate a format: one is declared and the
    // system converts. 48 kHz stereo float is the audio engine's native format.
    let format = Format {
        channels: 2,
        sample_rate: 48_000,
        bits: 32,
        float: true,
    };
    let mut wf = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_IEEE_FLOAT as u16,
        nChannels: format.channels,
        nSamplesPerSec: format.sample_rate,
        nAvgBytesPerSec: format.sample_rate * format.channels as u32 * 4,
        nBlockAlign: format.channels * 4,
        wBitsPerSample: 32,
        cbSize: 0,
    };

    let mut activation = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };

    unsafe {
        // `windows_core::PROPVARIANT` is opaque and will not build a VT_BLOB, so
        // the C layout is replicated and the pointer passed through. The
        // signature of ActivateAudioInterfaceAsync only transmutes it, it never
        // interprets it.
        let prop = BlobPropVariant {
            vt: VT_BLOB_TAG,
            r1: 0,
            r2: 0,
            r3: 0,
            cb_size: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            #[cfg(target_pointer_width = "64")]
            _pad: 0,
            p_blob: &mut activation as *mut _ as *mut u8,
        };
        let prop_ptr = &prop as *const BlobPropVariant as *const windows_core::PROPVARIANT;

        let event = CreateEventW(None, false, false, None)
            .map_err(|e| errors::with(errors::AUDIO_APP_CAPTURE, e))?;
        let handler: IActivateAudioInterfaceCompletionHandler =
            CompletionHandler { event }.into();

        let operation: IActivateAudioInterfaceAsyncOperation = ActivateAudioInterfaceAsync(
            VIRTUAL_LOOPBACK_DEVICE,
            &IAudioClient::IID,
            Some(prop_ptr),
            &handler,
        )
        .map_err(|e| errors::with(errors::AUDIO_APP_CAPTURE, e))?;

        if WaitForSingleObject(event, 3_000) != WAIT_OBJECT_0 {
            let _ = CloseHandle(event);
            return Err(errors::with(errors::AUDIO_APP_CAPTURE, "activation timed out"));
        }
        let _ = CloseHandle(event);

        let mut hr = windows::core::HRESULT(0);
        let mut unknown: Option<windows::core::IUnknown> = None;
        operation
            .GetActivateResult(&mut hr, &mut unknown)
            .map_err(|e| errors::with(errors::AUDIO_APP_CAPTURE, e))?;
        hr.ok()
            .map_err(|e| errors::with(errors::AUDIO_APP_CAPTURE, e))?;

        let client: IAudioClient = unknown
            .ok_or_else(|| errors::with(errors::AUDIO_APP_CAPTURE, "no audio client returned"))?
            .cast()
            .map_err(|e| errors::with(errors::AUDIO_APP_CAPTURE, e))?;

        client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                10_000_000,
                0,
                &mut wf,
                None,
            )
            .map_err(|e| errors::with(errors::AUDIO_START_CAPTURE, e))?;

        Ok((client, format))
    }
}
