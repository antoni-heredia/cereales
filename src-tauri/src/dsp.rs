//! Conversiones de señal entre lo que entrega WASAPI y lo que necesitan el
//! archivo WAV, el medidor de niveles y whisper.

/// Mezcla audio intercalado a mono promediando los canales.
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

/// Remuestreo por promediado de ventana.
///
/// El promedio actúa como filtro de media móvil, que quita el grueso del
/// aliasing al bajar de 44.1/48 kHz a los 16 kHz que pide whisper. No es un
/// remuestreador de calidad de audio, pero para voz destinada a ASR sobra y
/// evita arrastrar una dependencia más.
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

/// Reparte las muestras en `bands` tramos y devuelve el RMS de cada uno,
/// escalado a 0..1 para el medidor de la interfaz.
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
        // La voz normal se mueve muy abajo en escala lineal; la raíz cuadrada
        // reparte mejor el recorrido visible de las barras.
        out.push(rms.sqrt().clamp(0.0, 1.0));
    }
    out
}

/// Convierte f32 (-1..1) a i16 con saturación, para escribir el WAV.
pub fn f32_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mezcla_estereo_a_mono() {
        // Dos frames: (1.0, 0.0) y (0.5, -0.5)
        let out = to_mono(&[1.0, 0.0, 0.5, -0.5], 2);
        assert_eq!(out, vec![0.5, 0.0]);
    }

    /// La longitud tiene que seguir la razón de frecuencias: si no, el audio
    /// cambia de duración y las marcas de tiempo se desplazan.
    #[test]
    fn el_remuestreo_conserva_la_duracion() {
        for (src, dst) in [(48_000u32, 16_000u32), (44_100, 16_000), (16_000, 16_000)] {
            let seconds = 2.0;
            let input = vec![0.0f32; (src as f64 * seconds) as usize];
            let out = resample(&input, src, dst);
            let got = out.len() as f64 / dst as f64;
            assert!(
                (got - seconds).abs() < 0.01,
                "{src}->{dst}: duró {got:.3}s en vez de {seconds}s"
            );
        }
    }

    /// Una senoidal muy por debajo de Nyquist debe sobrevivir al remuestreo con
    /// amplitud parecida; si el filtro se la comiese, whisper recibiría voz
    /// atenuada.
    #[test]
    fn el_remuestreo_conserva_la_amplitud_de_voz() {
        let src = 48_000u32;
        let freq = 300.0; // grave de voz humana
        let input: Vec<f32> = (0..src)
            .map(|i| (i as f32 / src as f32 * freq * std::f32::consts::TAU).sin())
            .collect();
        let out = resample(&input, src, 16_000);
        let peak = out.iter().fold(0f32, |a, s| a.max(s.abs()));
        assert!(peak > 0.8, "la senoidal quedó atenuada a {peak:.3}");
    }

    #[test]
    fn los_niveles_van_de_cero_a_uno() {
        let bands = level_bands(&[1.0, -1.0, 1.0, -1.0], 2);
        assert_eq!(bands.len(), 2);
        assert!(bands.iter().all(|b| (0.0..=1.0).contains(b)));
        assert_eq!(level_bands(&[], 4), vec![0.0; 4]);
    }

    #[test]
    fn la_conversion_a_i16_satura() {
        assert_eq!(f32_to_i16(2.0), i16::MAX);
        assert_eq!(f32_to_i16(-2.0), -i16::MAX);
        assert_eq!(f32_to_i16(0.0), 0);
    }
}
