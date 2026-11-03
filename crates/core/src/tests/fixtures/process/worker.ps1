[Console]::Out.WriteLine("worker_started=$([DateTimeOffset]::Now.ToString('o'))")
[IO.File]::WriteAllText('cwd.txt', (Get-Location).Path, [Text.Encoding]::UTF8)
$p = Start-Process ping.exe -ArgumentList '127.0.0.1','-n','120' -PassThru -WindowStyle Hidden
[Console]::Out.WriteLine("child_started=$([DateTimeOffset]::Now.ToString('o')) pid=$($p.Id)")
[IO.File]::WriteAllText('child.pid', $p.Id.ToString())
Start-Sleep -Seconds 120
