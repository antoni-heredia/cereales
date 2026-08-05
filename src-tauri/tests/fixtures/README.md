# Fixtures de audio

`voz-es.wav` — voz sintetizada en español, mono 16 kHz, el mismo formato que
escribe el grabador. Lo usa el test de transcripción para comprobar whisper con
habla real en vez de con ruido.

Para regenerarlo (necesita la voz Helena de Windows):

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice("Microsoft Helena Desktop")
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile("voz-es.wav", $fmt)
$s.Speak("Empezamos con el repaso de metricas de retencion de la ultima semana.")
$s.Speak("La retencion a siete dias bajo dos puntos respecto al mes pasado.")
$s.Dispose()
```
