$uri = "https://script.google.com/macros/s/AKfycbxBt01BESHhHZQdoUILCtGVoSsoQVc8LexaikPgnJUa8XfsCgqRvus14Qce_lKyTK9nxA/exec"
$token = "TU_TOKEN_SECRETO"

# 1) Ping
$sw1 = [Diagnostics.Stopwatch]::StartNew()
try {
  $ping = Invoke-WebRequest -Uri "$uri`?action=ping&token=$token" -UseBasicParsing -TimeoutSec 90
  $sw1.Stop()
  Write-Output "PING_STATUS=$($ping.StatusCode)"
  Write-Output "PING_MS=$($sw1.ElapsedMilliseconds)"
  Write-Output "PING_BODY=$($ping.Content)"
} catch {
  $sw1.Stop()
  Write-Output "PING_ERR=$($_.Exception.Message)"
  Write-Output "PING_MS=$($sw1.ElapsedMilliseconds)"
}

# 2) POST guardar (conteo de prueba)
$payload = @{
  action = "guardar"
  token  = $token
  data   = @{
    localId         = "test-cursor-$(Get-Date -Format 'HHmmss')"
    editar          = $true
    licapa          = "LICAPA I"
    codSupervisor   = "99999999"
    dni             = "99999999"
    supervisor      = "PRUEBA CURSOR"
    fecha           = (Get-Date).ToString("yyyy-MM-dd")
    horaRegistro    = (Get-Date).ToString("HH:mm:ss")
    cosechadores    = 1
    escaner         = 0
    calidad         = 0
    supervisorCount = 0
    almuerzos       = 0
    permisos        = 0
    faltas          = 0
    distribucionZonas = @(
      @{ zona = "TEST-ZONA"; cantidad = 1 }
    )
  }
} | ConvertTo-Json -Depth 6 -Compress

$sw2 = [Diagnostics.Stopwatch]::StartNew()
try {
  $post = Invoke-WebRequest -Uri $uri -Method POST -Body $payload -ContentType "text/plain;charset=utf-8" -UseBasicParsing -TimeoutSec 90
  $sw2.Stop()
  Write-Output "POST_STATUS=$($post.StatusCode)"
  Write-Output "POST_MS=$($sw2.ElapsedMilliseconds)"
  Write-Output "POST_BODY=$($post.Content)"
} catch {
  $sw2.Stop()
  Write-Output "POST_ERR=$($_.Exception.Message)"
  Write-Output "POST_MS=$($sw2.ElapsedMilliseconds)"
}
