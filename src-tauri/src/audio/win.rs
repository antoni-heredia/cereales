//! Captura de audio con WASAPI.
//!
//! Tres modos, todos por el mismo camino (`IAudioCaptureClient` leído en bucle
//! desde un hilo propio):
//!
//! * **Micrófono** — `IAudioClient` normal sobre un endpoint de captura.
//! * **Audio del sistema** — el endpoint de render por defecto con
//!   `AUDCLNT_STREAMFLAGS_LOOPBACK`.
//! * **Por aplicación** — `ActivateAudioInterfaceAsync` con
//!   `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` (Windows 10 2004 / build
//!   19041 en adelante).
//!
//! Se lee por sondeo cada pocos milisegundos en lugar de con evento: el modo
//! loopback no admite `AUDCLNT_STREAMFLAGS_EVENTCALLBACK`, así que sondear deja
//! un solo bucle válido para los tres modos.

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

/// `windows` 0.58 no exporta esta constante en `Win32::Media::Audio`.
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
/// VT_BLOB, para el PROPVARIANT que lleva los parámetros de activación.
const VT_BLOB_TAG: u16 = 65;

use crate::dsp;
use crate::model::AudioSource;

/// Frecuencia y formato con los que se guarda el WAV: mono 16 kHz, que es lo que
/// consume whisper y sobra para voz. Evita guardar el original y remuestrear
/// después.
pub const OUT_RATE: u32 = 16_000;
const LEVEL_BANDS: usize = 24;
const POLL: Duration = Duration::from_millis(10);
/// Desfase tolerado antes de rellenar con silencio: 200 ms, muy por encima de la
/// latencia del búfer y muy por debajo de lo perceptible al saltar a una nota.
const SILENCE_SLACK: u64 = (OUT_RATE / 5) as u64;

/// PKEY_Device_FriendlyName; la constante generada vive tras una feature que no
/// siempre está activa, así que se declara aquí.
const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
    fmtid: windows::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 14,
};

/// Identificador del endpoint virtual que usa el loopback por proceso.
const VIRTUAL_LOOPBACK_DEVICE: PCWSTR = windows::core::w!("VAD\\Process_Loopback");

/// Qué se va a capturar, resuelto desde el id que manda el frontend.
pub enum SourceSpec {
    /// Endpoint de captura concreto (id de dispositivo WASAPI).
    Microphone(String),
    /// Endpoint de render por defecto, en modo loopback.
    System,
    /// Árbol de procesos de un PID.
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
                .map_err(|_| format!("PID inválido en la fuente: {id}")),
            _ => Err(format!("Fuente de audio desconocida: {id}")),
        }
    }
}

/// Envoltorio para que COM se inicialice y se cierre por hilo.
struct ComGuard {
    /// Solo se llama a `CoUninitialize` si fue este guard quien inicializó.
    owned: bool,
}

impl ComGuard {
    fn new() -> Result<Self, String> {
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if hr.is_ok() {
            return Ok(Self { owned: true });
        }
        // El hilo ya está en un apartment distinto (el principal de Tauri es
        // STA). No es un fallo: se puede seguir usando COM tal cual, pero no
        // nos toca cerrarlo.
        if hr == RPC_E_CHANGED_MODE {
            return Ok(Self { owned: false });
        }
        Err(format!("CoInitializeEx falló: {hr:?}"))
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.owned {
            unsafe { CoUninitialize() };
        }
    }
}

/// Ejecuta `f` en un hilo propio con COM en MTA.
///
/// Los comandos de Tauri corren en hilos cuyo apartment no controlamos; WASAPI
/// quiere MTA, así que cada operación se aísla en su propio hilo en vez de
/// depender de cómo quedara inicializado el hilo que llama.
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
    .map_err(|_| "El hilo de audio terminó de forma anómala.".to_string())?
}

// ---------------------------------------------------------------- enumeración

pub fn list_sources() -> Result<Vec<AudioSource>, String> {
    with_mta(enumerate)
}

fn enumerate() -> Result<Vec<AudioSource>, String> {
    let mut out = Vec::new();

    unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("No se pudo crear el enumerador de dispositivos: {e}"))?;

        // --- Entradas (micrófonos)
        let devices = enumerator
            .EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("No se pudieron enumerar las entradas: {e}"))?;
        for i in 0..devices.GetCount().unwrap_or(0) {
            let Ok(device) = devices.Item(i) else { continue };
            let Ok(id) = device.GetId() else { continue };
            let id_string = id.to_string().unwrap_or_default();
            CoTaskMemFree(Some(id.0 as *const _));
            if id_string.is_empty() {
                continue;
            }

            let name = device
                .OpenPropertyStore(STGM_READ)
                .ok()
                .and_then(|store| store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME).ok())
                .map(|v| v.to_string())
                .unwrap_or_else(|| "Micrófono".to_string());

            out.push(AudioSource {
                id: format!("mic:{id_string}"),
                label: name,
                group: "Entrada".to_string(),
            });
        }

        // --- Audio del sistema
        out.push(AudioSource {
            id: "sys:default".to_string(),
            label: "Audio del sistema (todo)".to_string(),
            group: "Audio del sistema".to_string(),
        });

        // --- Aplicaciones con sesión de audio activa
        if let Ok(render) = enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
            if let Ok(manager) = render.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) {
                if let Ok(sessions) = manager.GetSessionEnumerator() {
                    let mut seen: Vec<u32> = Vec::new();
                    for i in 0..sessions.GetCount().unwrap_or(0) {
                        let Ok(control) = sessions.GetSession(i) else { continue };
                        let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
                        // Las sesiones caducadas son de procesos que ya murieron.
                        let expired = control
                            .GetState()
                            .map(|s| s == AudioSessionStateExpired)
                            .unwrap_or(true);
                        if expired {
                            continue;
                        }
                        let Ok(pid) = control2.GetProcessId() else { continue };
                        // pid 0 es la sesión de sonidos del sistema.
                        if pid == 0 || seen.contains(&pid) {
                            continue;
                        }
                        seen.push(pid);
                        if let Some(name) = process_name(pid) {
                            out.push(AudioSource {
                                id: format!("app:{pid}"),
                                label: name,
                                group: "Aplicaciones".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(out)
}

/// Nombre legible de un proceso a partir de su PID.
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

// ------------------------------------------------------------------- captura

/// Destino de los lotes de niveles. Se inyecta para que la captura no dependa
/// de Tauri y se pueda ejercitar desde un test.
pub type LevelSink = Box<dyn Fn(Vec<f32>) + Send + 'static>;

pub struct CaptureHandle {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<Result<(), String>>>,
    pub path: PathBuf,
    pub started: Instant,
}

impl CaptureHandle {
    /// Para el hilo de captura y espera a que cierre el WAV.
    pub fn stop(mut self) -> Result<(), String> {
        self.stop.store(true, Ordering::SeqCst);
        match self.join.take() {
            Some(join) => join
                .join()
                .map_err(|_| "El hilo de captura terminó de forma anómala.".to_string())?,
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

    // El arranque se hace dentro del hilo (COM es por hilo), pero el resultado
    // de la inicialización tiene que volver aquí para poder fallar en el propio
    // `start_recording` en vez de en silencio.
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
        Err(_) => Err("El hilo de captura no llegó a arrancar.".to_string()),
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
            .map_err(|e| format!("No se pudo obtener IAudioCaptureClient: {e}"))?;
        unsafe { client.Start() }.map_err(|e| format!("No se pudo iniciar la captura: {e}"))?;

        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: OUT_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let writer = hound::WavWriter::create(&path, spec)
            .map_err(|e| format!("No se pudo crear el archivo de audio: {e}"))?;
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

    // En loopback, WASAPI no entrega paquetes mientras no suena nada: los
    // silencios simplemente no existen en el flujo. Sin compensarlos, el WAV
    // sale más corto que la reunión y las marcas de tiempo dejan de cuadrar con
    // las notas, que es justo lo que la app promete. Se lleva un reloj y se
    // rellenan los huecos con silencio.
    let clock = Instant::now();
    let mut written: u64 = 0;

    while !stop.load(Ordering::SeqCst) {
        let mut drained_any = false;
        loop {
            let packet = match unsafe { capture.GetNextPacketSize() } {
                Ok(n) => n,
                Err(e) => {
                    result = Err(format!("Fallo leyendo del búfer de audio: {e}"));
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
            if let Err(e) = unsafe { capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }
            {
                result = Err(format!("GetBuffer falló: {e}"));
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
                result = Err(format!("Error escribiendo el audio: {e}"));
                break;
            }
            written += resampled.len() as u64;
            pending.extend_from_slice(&resampled);
        }

        if result.is_err() {
            break;
        }

        // Rellena el silencio que WASAPI no entregó. El umbral deja pasar la
        // latencia normal del búfer; solo se compensan huecos de verdad.
        let expected = (clock.elapsed().as_secs_f64() * OUT_RATE as f64) as u64;
        if expected > written + SILENCE_SLACK {
            let gap = expected - written;
            let fill = (0..gap).try_for_each(|_| writer.write_sample(0i16));
            if let Err(e) = fill {
                result = Err(format!("Error rellenando silencio: {e}"));
                break;
            }
            written += gap;
        }

        // Un lote de niveles por cada ~100 ms de audio acumulado.
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
            result = Err(format!("No se pudo cerrar el archivo de audio: {e}"));
        }
    }
    // Deja las barras en reposo al terminar.
    on_levels(vec![0.0f32; LEVEL_BANDS]);
    result
}

/// Formato de captura ya interpretado, para no releer el WAVEFORMATEX en bucle.
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
        return Err("El dispositivo no devolvió formato de audio.".to_string());
    }
    let f = unsafe { *wf };
    // En modo compartido el formato suele ser WAVEFORMATEXTENSIBLE; para
    // distinguir float de PCM basta el tag, y para el extensible se deduce del
    // número de bits, que es lo único que cambia la lectura del búfer.
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
                    .map_err(|e| format!("No se pudo crear el enumerador: {e}"))?;
            let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
            let device = enumerator
                .GetDevice(PCWSTR(wide.as_ptr()))
                .map_err(|e| format!("No se encontró el micrófono seleccionado: {e}"))?;
            let client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("No se pudo activar el micrófono: {e}"))?;
            let wf = client
                .GetMixFormat()
                .map_err(|e| format!("No se pudo leer el formato del micrófono: {e}"))?;
            let format = parse_format(wf)?;
            client
                .Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 10_000_000, 0, wf, None)
                .map_err(|e| format!("No se pudo inicializar la captura del micrófono: {e}"))?;
            CoTaskMemFree(Some(wf as *const _));
            Ok((client, format))
        },

        SourceSpec::System => unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("No se pudo crear el enumerador: {e}"))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("No hay dispositivo de salida por defecto: {e}"))?;
            let client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("No se pudo activar la salida: {e}"))?;
            let wf = client
                .GetMixFormat()
                .map_err(|e| format!("No se pudo leer el formato de la salida: {e}"))?;
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
                .map_err(|e| format!("No se pudo inicializar el loopback del sistema: {e}"))?;
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

    /// Comprueba contra el WASAPI real de la máquina, no contra un mock.
    #[test]
    fn enumera_fuentes_reales() {
        let sources = list_sources().expect("la enumeración debería funcionar");
        for s in &sources {
            println!("[{}] {} -> {}", s.group, s.id, s.label);
        }
        assert!(
            sources.iter().any(|s| s.id == "sys:default"),
            "siempre debe ofrecerse el audio del sistema"
        );
        // Todo id emitido tiene que poder volver a parsearse.
        for s in &sources {
            SourceSpec::parse(&s.id).unwrap_or_else(|e| panic!("id no parseable {}: {e}", s.id));
        }
    }

    /// Graba de una fuente y devuelve (duración en segundos, pico de amplitud).
    fn grabar(spec: SourceSpec, seconds: u64) -> (f64, f32) {
        let path = std::env::temp_dir().join(format!("cereales-test-{}.wav", std::process::id()));
        let _ = std::fs::remove_file(&path);

        let handle = start(spec, path.clone(), Box::new(|_| {})).expect("debería arrancar");
        thread::sleep(Duration::from_secs(seconds));
        handle.stop().expect("debería cerrar limpiamente");

        let mut reader = hound::WavReader::open(&path).expect("WAV legible");
        let duration = reader.len() as f64 / OUT_RATE as f64;
        let peak = reader
            .samples::<i16>()
            .filter_map(|s| s.ok())
            .fold(0f32, |acc, s| acc.max((s as f32 / i16::MAX as f32).abs()));
        let _ = std::fs::remove_file(&path);
        (duration, peak)
    }

    /// El micrófono usa un `IAudioClient` normal, distinto del camino loopback.
    #[test]
    fn captura_desde_microfono() {
        let sources = list_sources().expect("enumeración");
        let Some(mic) = sources.iter().find(|s| s.group == "Entrada") else {
            eprintln!("sin micrófono en esta máquina; test omitido");
            return;
        };
        let spec = SourceSpec::parse(&mic.id).expect("id parseable");
        let (duration, peak) = grabar(spec, 2);
        println!("micrófono duración={duration:.2}s pico={peak:.4}");
        assert!(
            (duration - 2.0).abs() < 0.5,
            "el micrófono se desvía del reloj: {duration:.2}s"
        );
    }

    /// El loopback por proceso es el camino con COM asíncrono y el PROPVARIANT
    /// construido a mano: se comprueba que activa y captura sin fallar.
    #[test]
    fn captura_por_aplicacion() {
        let sources = list_sources().expect("enumeración");
        let Some(app) = sources.iter().find(|s| s.group == "Aplicaciones") else {
            eprintln!("ninguna app con sesión de audio; test omitido");
            return;
        };
        let spec = SourceSpec::parse(&app.id).expect("id parseable");
        let (duration, peak) = grabar(spec, 2);
        println!("app '{}' duración={duration:.2}s pico={peak:.4}", app.label);
        assert!(
            (duration - 2.0).abs() < 0.5,
            "la captura por app se desvía del reloj: {duration:.2}s"
        );
    }

    /// Captura de verdad el audio del sistema y comprueba que la duración del
    /// WAV corresponde al tiempo real transcurrido.
    ///
    /// Es la propiedad que sostiene toda la app: si el archivo sale más corto
    /// que la reunión, las notas con marca de tiempo apuntan al sitio
    /// equivocado. Se cumple aunque no suene nada, que es el caso en que WASAPI
    /// no entrega paquetes.
    #[test]
    fn la_duracion_capturada_sigue_al_reloj() {
        let path = std::env::temp_dir().join("cereales-test-captura.wav");
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
        .expect("la captura del sistema debería arrancar");

        let seconds = 3;
        thread::sleep(Duration::from_secs(seconds));
        handle.stop().expect("la captura debería cerrar limpiamente");

        let reader = hound::WavReader::open(&path).expect("el WAV debería ser legible");
        let spec = reader.spec();
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.sample_rate, OUT_RATE);

        let samples = reader.len() as f64;
        let duration = samples / OUT_RATE as f64;
        println!(
            "duración={duration:.2}s muestras={samples} lotes_de_niveles={}",
            batches.load(Ordering::SeqCst)
        );
        let drift = (duration - seconds as f64).abs();
        assert!(
            drift < 0.5,
            "el audio se desvía {drift:.2}s del reloj: las marcas de tiempo no cuadrarían"
        );
        let _ = std::fs::remove_file(&path);
    }
}

/// Réplica del layout C de `PROPVARIANT` para el caso VT_BLOB.
///
/// El tipo de `windows-core` es opaco (gestiona su propio Drop) y no permite
/// construir un blob, que es justo lo que pide `ActivateAudioInterfaceAsync`.
#[repr(C)]
struct BlobPropVariant {
    vt: u16,
    r1: u16,
    r2: u16,
    r3: u16,
    cb_size: u32,
    /// La unión se alinea a 8 en 64 bits; en 32 bits el puntero va pegado.
    #[cfg(target_pointer_width = "64")]
    _pad: u32,
    p_blob: *mut u8,
}

// Si este assert salta, el layout dejó de coincidir y pasar el puntero sería
// corrupción de memoria en vez de un error visible.
const _: () = assert!(
    std::mem::size_of::<BlobPropVariant>() == std::mem::size_of::<windows_core::PROPVARIANT>()
);

/// Handler de finalización que exige `ActivateAudioInterfaceAsync`. Solo señala
/// un evento; el resultado se recoge desde el hilo que espera.
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
    // El loopback por proceso no negocia formato: se declara uno y el sistema
    // convierte. 48 kHz estéreo float es el formato nativo del motor de audio.
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
        // `windows_core::PROPVARIANT` es opaco y no deja construir un VT_BLOB,
        // así que se replica el layout en C y se pasa el puntero. La firma de
        // ActivateAudioInterfaceAsync solo lo transmuta, nunca lo interpreta.
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
            .map_err(|e| format!("No se pudo crear el evento de activación: {e}"))?;
        let handler: IActivateAudioInterfaceCompletionHandler =
            CompletionHandler { event }.into();

        let operation: IActivateAudioInterfaceAsyncOperation = ActivateAudioInterfaceAsync(
            VIRTUAL_LOOPBACK_DEVICE,
            &IAudioClient::IID,
            Some(prop_ptr),
            &handler,
        )
        .map_err(|e| format!("No se pudo activar la captura por aplicación: {e}"))?;

        if WaitForSingleObject(event, 3_000) != WAIT_OBJECT_0 {
            let _ = CloseHandle(event);
            return Err("La activación de la captura por aplicación no respondió.".to_string());
        }
        let _ = CloseHandle(event);

        let mut hr = windows::core::HRESULT(0);
        let mut unknown: Option<windows::core::IUnknown> = None;
        operation
            .GetActivateResult(&mut hr, &mut unknown)
            .map_err(|e| format!("No se pudo leer el resultado de la activación: {e}"))?;
        hr.ok()
            .map_err(|e| format!("La captura por aplicación fue rechazada: {e}"))?;

        let client: IAudioClient = unknown
            .ok_or_else(|| "La activación no devolvió un cliente de audio.".to_string())?
            .cast()
            .map_err(|e| format!("Tipo inesperado en la activación: {e}"))?;

        client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                10_000_000,
                0,
                &mut wf,
                None,
            )
            .map_err(|e| format!("No se pudo inicializar la captura por aplicación: {e}"))?;

        Ok((client, format))
    }
}
