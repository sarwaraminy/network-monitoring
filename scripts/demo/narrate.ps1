<#
.SYNOPSIS
  Speaks the tour's narration into WAV files, for `record-demo.mjs` to lay under
  the video.

.DESCRIPTION
  Uses the speech engine that ships with Windows, through System.Speech. That is
  the whole reason this is a PowerShell file in a repository with no other one:
  the alternative is a cloud text-to-speech service, which would mean an API key
  in the recording path and the narration script sent to a third party to
  produce a file this machine can already produce offline. The tool is aimed at
  networks with no outbound internet; its own demo should not need any.

  Voices are whatever the machine has. A stock Windows install has David and
  Zira, and they sound synthetic — clear, but plainly a computer reading. That is
  a fair trade for captions that can be corrected in a text editor and a tour
  anybody can re-record, and it is why the captions on screen carry the same
  words: the video is watchable with the sound off.

.PARAMETER Manifest
  A JSON file holding an array of { file, text } objects. Written by the recorder
  rather than assembled here, so the narration lives beside the captions it
  matches.

.PARAMETER Voice
  Substring of an installed voice's name. Falls back to any en-US voice, then to
  whatever the engine defaults to.

.PARAMETER Rate
  -10 (slowest) to 10. A little under default is easier to follow, and gives the
  eye time to find what the caption is talking about.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/demo/narrate.ps1 -Manifest lines.json
#>

param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [string]$Voice = 'Zira',
  [int]$Rate = -1
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Speech

$lines = Get-Content -Raw -Encoding UTF8 -Path $Manifest | ConvertFrom-Json

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# Chosen by substring so a caller can ask for "Zira" without knowing that the
# installed name is "Microsoft Zira Desktop", which differs between builds.
$installed = $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo }
$wanted = $installed | Where-Object { $_.Name -like "*$Voice*" } | Select-Object -First 1
if ($null -eq $wanted) {
  $wanted = $installed | Where-Object { $_.Culture.Name -eq 'en-US' } | Select-Object -First 1
}
if ($null -ne $wanted) {
  $synth.SelectVoice($wanted.Name)
  Write-Output "voice: $($wanted.Name)"
}

$synth.Rate = $Rate

# 24 kHz mono is above what a synthetic voice carries and a third of the bytes of
# the 48 kHz stereo default. The track is speech over silence; there is nothing
# in it for the extra bandwidth to describe.
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  24000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)

try {
  foreach ($line in $lines) {
    $synth.SetOutputToWaveFile($line.file, $format)
    $synth.Speak($line.text)
    # Released before the next file is opened, or the last clip stays locked and
    # zero bytes long.
    $synth.SetOutputToNull()
    Write-Output "spoke: $($line.file)"
  }
}
finally {
  $synth.Dispose()
}
