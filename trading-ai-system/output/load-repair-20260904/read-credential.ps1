Add-Type @'
using System;
using System.Runtime.InteropServices;
public class LoadCheckCredential {
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
 [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
 public struct Credential { public uint Flags; public uint Type; public string TargetName; public string Comment; public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
}
'@
$credentialPointer = [IntPtr]::Zero
if (-not [LoadCheckCredential]::CredRead('ElectricTradingAI/JSPEC', 1, 0, [ref]$credentialPointer)) { throw 'Credential unavailable' }
try {
 $credentialRecord = [Runtime.InteropServices.Marshal]::PtrToStructure($credentialPointer, [type][LoadCheckCredential+Credential])
 $credentialSecret = [Runtime.InteropServices.Marshal]::PtrToStringUni($credentialRecord.CredentialBlob, $credentialRecord.CredentialBlobSize / 2)
 @{ username = $credentialRecord.UserName; password = $credentialSecret } | ConvertTo-Json -Compress
} finally { [LoadCheckCredential]::CredFree($credentialPointer) }
