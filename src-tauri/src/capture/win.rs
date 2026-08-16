//! Full-screen capture on Windows: GDI takes the pixels, WIC encodes the PNG.
//!
//! The whole virtual screen is grabbed in one shot — every monitor, in the
//! layout the user has them in — and the editor is where a region is chosen.
//! That is deliberate: a picker dialog in the middle of a meeting costs more
//! than cropping afterwards does.
//!
//! Everything runs on a thread of its own. The capture changes the thread's DPI
//! awareness and wants a COM apartment it controls, and neither is something to
//! do to whichever thread Tauri happened to run the command on.

use std::ffi::c_void;

use windows::Win32::Foundation::{HWND, RPC_E_CHANGED_MODE};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
    HBITMAP, HDC, HGDIOBJ, SRCCOPY,
};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_ContainerFormatPng, GUID_WICPixelFormat32bppBGRA,
    IWICBitmapFrameEncode, IWICImagingFactory, WICBitmapEncoderNoCache,
};
use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET,
};
use windows::Win32::UI::HiDpi::{
    SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

use crate::errors;

pub fn grab_virtual_screen() -> Result<Vec<u8>, String> {
    std::thread::spawn(capture)
        .join()
        .map_err(|_| errors::with(errors::CAPTURE_SCREEN, "capture thread panicked"))?
}

fn capture() -> Result<Vec<u8>, String> {
    // Without this the metrics below come back in logical pixels on a scaled
    // display and BitBlt hands over a downscaled, blurry image. Restored on the
    // way out even though the thread is about to end, so the call reads as the
    // scoped change it is.
    let previous_dpi =
        unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let result = capture_dpi_aware();
    unsafe { SetThreadDpiAwarenessContext(previous_dpi) };
    result
}

fn capture_dpi_aware() -> Result<Vec<u8>, String> {
    let _com = ComGuard::new()?;

    let (x, y) = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
        )
    };
    let (width, height) = unsafe {
        (
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    };
    if width <= 0 || height <= 0 {
        return Err(errors::with(
            errors::CAPTURE_SCREEN,
            format!("{width}x{height}"),
        ));
    }

    let surface = Surface::new(width, height)?;
    unsafe {
        BitBlt(
            surface.mem,
            0,
            0,
            width,
            height,
            surface.screen,
            x,
            y,
            // CAPTUREBLT is what pulls in layered windows; without it a
            // transparent overlay leaves a hole in the capture.
            SRCCOPY | CAPTUREBLT,
        )
    }
    .map_err(|e| errors::with(errors::CAPTURE_BLIT, e))?;

    // GDI batches its drawing, and reading the bits without flushing first is
    // the classic way to end up with half a capture.
    unsafe {
        let _ = GdiFlush();
    };

    let stride = width as usize * 4;
    let pixels =
        unsafe { std::slice::from_raw_parts_mut(surface.pixels.cast::<u8>(), stride * height as usize) };
    // BitBlt leaves the alpha channel at zero. Encoding BGRA as it stands would
    // write a fully transparent PNG, which looks exactly like a failed capture.
    for pixel in pixels.chunks_exact_mut(4) {
        pixel[3] = 0xFF;
    }

    encode_png(pixels, width as u32, height as u32, stride as u32)
}

fn encode_png(pixels: &[u8], width: u32, height: u32, stride: u32) -> Result<Vec<u8>, String> {
    let fail = |e: windows::core::Error| errors::with(errors::CAPTURE_ENCODE, e);

    unsafe {
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).map_err(fail)?;
        // Growable in-memory stream: the PNG only ever needs to reach the
        // frontend, so there is nothing to gain from a temporary file.
        let stream = CreateStreamOnHGlobal(None, true).map_err(fail)?;

        let encoder = factory
            .CreateEncoder(&GUID_ContainerFormatPng, std::ptr::null())
            .map_err(fail)?;
        encoder
            .Initialize(&stream, WICBitmapEncoderNoCache)
            .map_err(fail)?;

        let mut frame: Option<IWICBitmapFrameEncode> = None;
        encoder
            .CreateNewFrame(&mut frame, std::ptr::null_mut())
            .map_err(fail)?;
        let frame = frame.ok_or_else(|| errors::with(errors::CAPTURE_ENCODE, "no frame"))?;
        frame.Initialize(None).map_err(fail)?;
        frame.SetSize(width, height).map_err(fail)?;

        // WIC writes back the nearest format it supports rather than failing, so
        // a mismatch has to be checked: writing BGRA into something else would
        // encode garbage silently. PNG supports this one natively.
        let mut format = GUID_WICPixelFormat32bppBGRA;
        frame.SetPixelFormat(&mut format).map_err(fail)?;
        if format != GUID_WICPixelFormat32bppBGRA {
            return Err(errors::with(errors::CAPTURE_ENCODE, format!("{format:?}")));
        }

        frame.WritePixels(height, stride, pixels).map_err(fail)?;
        frame.Commit().map_err(fail)?;
        encoder.Commit().map_err(fail)?;

        let mut stat = STATSTG::default();
        stream.Stat(&mut stat, STATFLAG_NONAME).map_err(fail)?;
        stream.Seek(0, STREAM_SEEK_SET, None).map_err(fail)?;

        let mut png = vec![0u8; stat.cbSize as usize];
        let mut read = 0u32;
        stream
            .Read(png.as_mut_ptr().cast(), png.len() as u32, Some(&mut read))
            .ok()
            .map_err(fail)?;
        png.truncate(read as usize);
        Ok(png)
    }
}

/// Wrapper so COM is initialised and torn down per thread.
struct ComGuard {
    /// `CoUninitialize` is only called if this guard did the initialising.
    owned: bool,
}

impl ComGuard {
    fn new() -> Result<Self, String> {
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if hr.is_ok() {
            return Ok(Self { owned: true });
        }
        if hr == RPC_E_CHANGED_MODE {
            return Ok(Self { owned: false });
        }
        Err(errors::with(errors::CAPTURE_COM, format!("{hr:?}")))
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.owned {
            unsafe { CoUninitialize() };
        }
    }
}

/// The device contexts and the bitmap the capture draws into, owned together so
/// that an early `?` on any step cannot leak a DC.
struct Surface {
    screen: HDC,
    mem: HDC,
    bitmap: HBITMAP,
    restore: HGDIOBJ,
    pixels: *mut c_void,
}

impl Surface {
    fn new(width: i32, height: i32) -> Result<Self, String> {
        let screen = unsafe { GetDC(HWND::default()) };
        if screen.is_invalid() {
            return Err(errors::with(errors::CAPTURE_SCREEN, "no screen DC"));
        }
        let mem = unsafe { CreateCompatibleDC(screen) };
        if mem.is_invalid() {
            unsafe { ReleaseDC(HWND::default(), screen) };
            return Err(errors::with(errors::CAPTURE_BITMAP, "no memory DC"));
        }

        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                // Negative height asks for a top-down buffer, which is the row
                // order WIC expects; a bottom-up one would come out mirrored.
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut pixels: *mut c_void = std::ptr::null_mut();
        let bitmap = unsafe {
            CreateDIBSection(screen, &info, DIB_RGB_COLORS, &mut pixels, None, 0)
                .map_err(|e| errors::with(errors::CAPTURE_BITMAP, e))
        };
        let bitmap = match bitmap {
            Ok(bitmap) => bitmap,
            Err(message) => {
                unsafe {
                    let _ = DeleteDC(mem);
                    ReleaseDC(HWND::default(), screen);
                }
                return Err(message);
            }
        };

        let restore = unsafe { SelectObject(mem, bitmap) };
        Ok(Self {
            screen,
            mem,
            bitmap,
            restore,
            pixels,
        })
    }
}

impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.mem, self.restore);
            let _ = DeleteObject(self.bitmap);
            let _ = DeleteDC(self.mem);
            ReleaseDC(HWND::default(), self.screen);
        }
    }
}
