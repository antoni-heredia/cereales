# Audio fixtures

`voz-es.wav` — synthesized Spanish speech, mono 16 kHz, the same format the
recorder writes. The transcription test uses it to exercise whisper against real
speech rather than noise. It stays Spanish whatever the interface language is:
what it checks is that `run_whisper` honours the language it is handed.

To regenerate it (needs the Windows Helena voice):

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
