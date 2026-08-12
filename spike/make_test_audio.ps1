# Build a 2-speaker test WAV (male/female alternating turns) for the
# diarization spike. No Persian voice is installed on this box — the
# diarizer is language-agnostic (speaker embeddings, not words), so English
# turns validate clustering; Persian WER is spike item 3's question.
param(
  [string]$Out = "two_speakers.wav",
  [int]$Rounds = 10
)
Add-Type -AssemblyName System.Speech

$linesA = @(
  "Let's start with the quarterly budget review.",
  "Marketing needs a twenty percent increase this cycle.",
  "I disagree, the numbers from last quarter don't support that.",
  "We should look at the conversion data before deciding.",
  "Fine, let's table it until the data comes in."
)
$linesB = @(
  "I have the conversion figures right here actually.",
  "They show a clear upward trend since the campaign started.",
  "That's exactly the argument I was making earlier.",
  "Can you send those numbers to the whole team today?",
  "Consider it done, I'll have it out this afternoon."
)

$parts = @()
for ($i = 0; $i -lt $Rounds; $i++) {
  $parts += ,@("David", $linesA[$i % $linesA.Count])
  $parts += ,@("Zira",  $linesB[$i % $linesB.Count])
}

$tmpDir = Join-Path $PSScriptRoot "tts_parts"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$index = 0
foreach ($p in $parts) {
  $voice = if ($p[0] -eq "David") { "Microsoft David Desktop" } else { "Microsoft Zira Desktop" }
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice($voice)
  $file = Join-Path $tmpDir ("part_{0:D3}.wav" -f $index)
  $synth.SetOutputToWaveFile($file)
  $synth.Speak($p[1])
  $synth.Dispose()
  $index++
}
Write-Output "generated $index parts in $tmpDir"
