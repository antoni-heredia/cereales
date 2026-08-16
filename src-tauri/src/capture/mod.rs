//! Screen capture and the base64 codec the screenshot round trip uses.
//!
//! Like audio capture, this is written against Windows and refuses explicitly
//! elsewhere rather than pretending it worked.
//!
//! The PNG never touches the filesystem here: it is handed to the frontend as
//! base64 and only written once the user saves the annotated result, so
//! cancelling the editor leaves nothing behind to clean up. Base64 is also what
//! keeps the editor able to export at all — the image arrives as a `data:` URL,
//! which is same-origin, and a canvas that drew a cross-origin image cannot be
//! read back.

#[cfg(windows)]
mod win;

use crate::errors;

/// Refuses anything that would decode to more than this. A screenshot of a
/// large multi-monitor desktop lands well under it; the point is that a
/// malformed payload cannot make the backend allocate without bound.
const MAX_SCREENSHOT_BYTES: usize = 64 * 1024 * 1024;

/// The whole virtual screen as a PNG, base64-encoded so it crosses the IPC
/// boundary as the `String` every other command already speaks.
#[tauri::command]
pub fn capture_screen() -> Result<String, String> {
    #[cfg(windows)]
    {
        win::grab_virtual_screen().map(|png| encode_base64(&png))
    }
    #[cfg(not(windows))]
    {
        Err(errors::CAPTURE_ONLY_WINDOWS.to_string())
    }
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn encode_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for group in bytes.chunks(3) {
        let packed = (u32::from(group[0]) << 16)
            | (u32::from(group.get(1).copied().unwrap_or(0)) << 8)
            | u32::from(group.get(2).copied().unwrap_or(0));
        out.push(ALPHABET[(packed >> 18) as usize & 63] as char);
        out.push(ALPHABET[(packed >> 12) as usize & 63] as char);
        out.push(if group.len() > 1 {
            ALPHABET[(packed >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if group.len() > 2 {
            ALPHABET[packed as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn sextet(byte: u8) -> Option<u32> {
    let value = match byte {
        b'A'..=b'Z' => byte - b'A',
        b'a'..=b'z' => byte - b'a' + 26,
        b'0'..=b'9' => byte - b'0' + 52,
        b'+' => 62,
        b'/' => 63,
        _ => return None,
    };
    Some(u32::from(value))
}

/// Decodes what the editor produced. Padding carries no information and is
/// skipped, so the length check has to be on the leftover bits instead: six of
/// them mean a group was cut in half, while four or two are the legitimate tail
/// of a one- or two-byte remainder.
pub fn decode_base64(text: &str) -> Result<Vec<u8>, String> {
    if text.len() / 4 * 3 > MAX_SCREENSHOT_BYTES {
        return Err(errors::with(errors::CAPTURE_TOO_LARGE, text.len()));
    }

    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for (index, byte) in text.bytes().enumerate() {
        if matches!(byte, b'=' | b'\r' | b'\n') {
            continue;
        }
        let value =
            sextet(byte).ok_or_else(|| errors::with(errors::CAPTURE_DECODE, format!("@{index}")))?;
        acc = (acc << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    if bits >= 6 {
        return Err(errors::with(errors::CAPTURE_DECODE, text.len()));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_rfc_vectors() {
        assert_eq!(encode_base64(b""), "");
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
        assert_eq!(encode_base64(b"foob"), "Zm9vYg==");
        assert_eq!(decode_base64("Zg==").unwrap(), b"f");
        assert_eq!(decode_base64("Zm8=").unwrap(), b"fo");
        assert_eq!(decode_base64("Zm9v").unwrap(), b"foo");
    }

    #[test]
    fn base64_round_trips_every_byte() {
        // Three lengths so each of the three padding cases is exercised.
        for extra in 0..3 {
            let bytes: Vec<u8> = (0..=255u8).chain(0..extra).collect();
            assert_eq!(decode_base64(&encode_base64(&bytes)).unwrap(), bytes);
        }
    }

    #[test]
    fn base64_rejects_junk_and_truncated_groups() {
        assert!(decode_base64("Zm9v!!!!").is_err());
        // A lone sextet is half a byte: not something to silently drop.
        assert!(decode_base64("Zm9vZ").is_err());
    }

    #[test]
    fn errors_travel_as_keys() {
        let message = decode_base64("**").unwrap_err();
        assert!(message.starts_with("err."), "{message}");
        assert!(message.contains('|'), "{message}");
    }

    /// Runs against the real screen, like the audio tests do against real
    /// WASAPI. It is the only way to catch the two mistakes that produce a file
    /// which *looks* fine to the encoder and useless to the user: an all-zero
    /// alpha channel, and a capture taken at logical instead of physical size.
    #[cfg(windows)]
    #[test]
    fn captures_the_real_screen() {
        let png = win::grab_virtual_screen().expect("the screen should be capturable");
        assert!(
            png.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
            "not a PNG: {:?}",
            &png[..png.len().min(8)]
        );

        // Width and height live big-endian in the IHDR chunk, bytes 16..24.
        let word = |at: usize| u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]);
        let (width, height) = (word(16), word(20));
        assert!(width > 0 && height > 0, "{width}x{height}");

        // A blank desktop still compresses to more than this; a PNG of nothing
        // but transparent pixels would not.
        assert!(png.len() > 2000, "suspiciously small: {} bytes", png.len());

        // Printed like the audio tests print theirs: on a scaled display this is
        // what shows the capture came back at physical, not logical, size.
        eprintln!("screen {width}x{height} png={} bytes", png.len());
    }
}
