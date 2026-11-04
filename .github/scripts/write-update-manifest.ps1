param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$SignaturePath,
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$OutFile
)

$signature = (Get-Content -Raw -LiteralPath $SignaturePath).Trim()
$platform = @{ signature = $signature; url = $Url }
$manifest = [ordered]@{
  version = $Version
  notes = "kaleidoscope v$Version"
  pub_date = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
  platforms = @{
    'windows-x86_64-nsis' = $platform
    'windows-x86_64' = $platform
  }
}
$json = $manifest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($OutFile, $json, [Text.UTF8Encoding]::new($false))
