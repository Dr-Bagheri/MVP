# Synthesise demo speech with Windows SAPI (System.Speech) — one wav per line.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File sapi-say.ps1 -Manifest <path.json>
#
# The manifest is a JSON array of { voice, text, out, rate? }. Every clip is
# written as 16 kHz · mono · 16-bit PCM so the seed script can splice them
# sample-exactly without a resample. Used only by seed-demo-records.mjs;
# this is a dev/demo tool, never a migration and never a runtime dependency.
#
# PS 5.1 hazards honoured here: the manifest is read with ReadAllText (a
# BOM-less UTF-8 file read by Get-Content -Raw is decoded as ANSI), and this
# script writes no text files at all — only the synthesiser writes, in binary.
param(
  [Parameter(Mandatory = $true)][string] $Manifest
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$json = [System.IO.File]::ReadAllText($Manifest, (New-Object System.Text.UTF8Encoding($false)))
$lines = ConvertFrom-Json $json
if ($lines -isnot [System.Array]) { $lines = @($lines) }

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  16000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono)

$installed = @($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })
$n = 0
try {
  foreach ($line in $lines) {
    if ($installed -notcontains $line.voice) {
      throw "voice not installed: $($line.voice) (have: $($installed -join ', '))"
    }
    $synth.SelectVoice($line.voice)
    if ($null -ne $line.rate) { $synth.Rate = [int]$line.rate } else { $synth.Rate = 0 }
    $synth.Volume = 100
    $dir = [System.IO.Path]::GetDirectoryName($line.out)
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $synth.SetOutputToWaveFile($line.out, $fmt)
    $synth.Speak([string]$line.text)
    $synth.SetOutputToNull()
    $n++
  }
} finally {
  $synth.Dispose()
}
Write-Output "sapi-say: wrote $n clip(s)"
