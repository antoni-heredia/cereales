//! Signal conversions between what WASAPI delivers and what the WAV file, the
//! level meter and whisper need.

/// Mixes interleaved audio down to mono by averaging the channels.
pub fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    let frames = interleaved.len() / channels;
    let mut out = Vec::with_capacity(frames);
    for frame in 0..frames {
        let base = frame * channels;
        let sum: f32 = interleaved[base..base + channels].iter().sum();
        out.push(sum / channels as f32);
    }
    out
}

/// Resampling by window averaging.
///
/// The average acts as a moving-average filter, which removes most of the
/// aliasing when going from 44.1/48 kHz down to the 16 kHz whisper asks for. It
/// is not an audio-quality resampler, but for speech destined for ASR it is
/// plenty and it avoids dragging in another dependency.
pub fn resample(input: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if input.is_empty() || src_rate == 0 || dst_rate == 0 || src_rate == dst_rate {
        return input.to_vec();
    }
    let ratio = src_rate as f64 / dst_rate as f64;
    let out_len = (input.len() as f64 / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let start = (i as f64 * ratio).floor() as usize;
        let end = (((i + 1) as f64) * ratio).ceil() as usize;
        let start = start.min(input.len().saturating_sub(1));
        let end = end.min(input.len()).max(start + 1);
        let window = &input[start..end];
        let sum: f32 = window.iter().sum();
        out.push(sum / window.len() as f32);
    }
    out
}

/// Splits the samples into `bands` slices and returns the RMS of each one,
/// scaled to 0..1 for the meter in the interface.
pub fn level_bands(samples: &[f32], bands: usize) -> Vec<f32> {
    if bands == 0 {
        return Vec::new();
    }
    if samples.is_empty() {
        return vec![0.0; bands];
    }

    let per_band = (samples.len() / bands).max(1);
    let mut out = Vec::with_capacity(bands);
    for band in 0..bands {
        let start = (band * per_band).min(samples.len());
        let end = ((band + 1) * per_band).min(samples.len());
        if start >= end {
            out.push(0.0);
            continue;
        }
        let sum_sq: f32 = samples[start..end].iter().map(|s| s * s).sum();
        let rms = (sum_sq / (end - start) as f32).sqrt();
        // Ordinary speech sits very low on a linear scale; the square root
        // spreads the visible travel of the bars far better.
        out.push(rms.sqrt().clamp(0.0, 1.0));
    }
    out
}

/// Converts f32 (-1..1) to i16 with saturation, for writing the WAV.
pub fn f32_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixes_stereo_to_mono() {
        // Two frames: (1.0, 0.0) and (0.5, -0.5)
        let out = to_mono(&[1.0, 0.0, 0.5, -0.5], 2);
        assert_eq!(out, vec![0.5, 0.0]);
    }

    /// The length has to follow the rate ratio: otherwise the audio changes
    /// duration and the timestamps shift.
    #[test]
    fn resampling_preserves_duration() {
        for (src, dst) in [(48_000u32, 16_000u32), (44_100, 16_000), (16_000, 16_000)] {
            let seconds = 2.0;
            let input = vec![0.0f32; (src as f64 * seconds) as usize];
            let out = resample(&input, src, dst);
            let got = out.len() as f64 / dst as f64;
            assert!(
                (got - seconds).abs() < 0.01,
                "{src}->{dst}: lasted {got:.3}s instead of {seconds}s"
            );
        }
    }

    /// A sine well below Nyquist must survive resampling with a similar
    /// amplitude; if the filter ate it, whisper would receive attenuated speech.
    #[test]
    fn resampling_preserves_speech_amplitude() {
        let src = 48_000u32;
        let freq = 300.0; // low end of the human voice
        let input: Vec<f32> = (0..src)
            .map(|i| (i as f32 / src as f32 * freq * std::f32::consts::TAU).sin())
            .collect();
        let out = resample(&input, src, 16_000);
        let peak = out.iter().fold(0f32, |a, s| a.max(s.abs()));
        assert!(peak > 0.8, "the sine was attenuated to {peak:.3}");
    }

    #[test]
    fn levels_run_from_zero_to_one() {
        let bands = level_bands(&[1.0, -1.0, 1.0, -1.0], 2);
        assert_eq!(bands.len(), 2);
        assert!(bands.iter().all(|b| (0.0..=1.0).contains(b)));
        assert_eq!(level_bands(&[], 4), vec![0.0; 4]);
    }

    #[test]
    fn the_i16_conversion_saturates() {
        assert_eq!(f32_to_i16(2.0), i16::MAX);
        assert_eq!(f32_to_i16(-2.0), -i16::MAX);
        assert_eq!(f32_to_i16(0.0), 0);
    }
}
