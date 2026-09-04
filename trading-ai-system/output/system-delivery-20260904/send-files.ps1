param([int]$First=2,[int]$Last=15,[string]$Package='')
$ErrorActionPreference='Stop'
$deliveryProfile='ding099f2386fcae50f0a1320dcb25e91351:c0d7dba0-159d-42e6-b1e5-9d03a6cb10d1'
$recipient='DUQUeyoxiiOy8qlLNKZYZrsAYNiPefBX6pS'
$receiptRoot=Join-Path $PSScriptRoot 'receipts'
New-Item -ItemType Directory -Path $receiptRoot -Force | Out-Null
$files=@()
if($Package){$files=@(Get-Item -LiteralPath $Package)}else{$files=@(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'screenshots') -Filter '*.png' | Where-Object {[int]$_.Name.Substring(0,2) -ge $First -and [int]$_.Name.Substring(0,2) -le $Last} | Sort-Object Name)}
foreach($file in $files){
 $id=if($Package){'electric-delivery-20260904-package-final'}else{'electric-delivery-20260904-screenshot-'+$file.Name.Substring(0,2)}
 $receiptPath=Join-Path $receiptRoot ($id+'.json')
 $sent=$null
 if(Test-Path -LiteralPath $receiptPath){$sent=Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json}
 if(-not $sent){
  $sendArgs=@('chat','message','send','--profile',$deliveryProfile,'--open-dingtalk-id',$recipient,'--msg-type','file','--file-path',$file.FullName,'--uuid',$id,'--format','json','--timeout','180')
  $raw=& dws @sendArgs
  $sent=$raw | ConvertFrom-Json
  if(-not $sent.success){$raw=& dws @sendArgs --verbose;$sent=$raw | ConvertFrom-Json}
  if(-not $sent.success){throw ($raw -join [Environment]::NewLine)}
  $sent | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
 }
 $result=& dws chat +messages-query-send-status --profile $deliveryProfile --open-task-id $sent.result.openTaskId --format json | ConvertFrom-Json
 $result | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $receiptRoot ($id+'-status.json')) -Encoding UTF8
 if($result.result.sendStatus -ne 'SUCCESS'){throw ('Message not confirmed: '+($result | ConvertTo-Json -Depth 10))}
 Write-Output ($file.Name+' : SUCCESS : '+$result.result.openMessageId)
}
