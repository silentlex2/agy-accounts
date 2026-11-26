param([Parameter(Mandatory=$true)][string]$Action, [string]$Target = 'gemini:antigravity', [string]$BlobPath, [string]$UserName = 'antigravity')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class NativeCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredReadW(string target, int type, int reserved, out IntPtr credential);
  [DllImport("advapi32", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWriteW(ref CREDENTIAL credential, int flags);
  [DllImport("advapi32", SetLastError=true)]
  public static extern bool CredDeleteW(string target, int type, int flags);
  [DllImport("advapi32")]
  public static extern void CredFree(IntPtr buffer);
  public static byte[] ReadBlob(string target) {
    IntPtr p; if (!CredReadW(target, 1, 0, out p)) throw new Exception("CredRead failed " + Marshal.GetLastWin32Error());
    CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    byte[] b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p); return b;
  }
  public static string ReadUser(string target) {
    IntPtr p; if (!CredReadW(target, 1, 0, out p)) return null;
    CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    string u = Marshal.PtrToStringUni(c.UserName); CredFree(p); return u;
  }
  public static void Write(string target, string user, byte[] blob) {
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1; c.Persist = 2; c.UserName = Marshal.StringToCoTaskMemUni(user);
    c.TargetName = Marshal.StringToCoTaskMemUni(target);
    c.CredentialBlobSize = blob.Length;
    c.CredentialBlob = Marshal.AllocCoTaskMem(blob.Length);
    Marshal.Copy(blob, 0, c.CredentialBlob, blob.Length);
    if (!CredWriteW(ref c, 0)) throw new Exception("CredWrite failed " + Marshal.GetLastWin32Error());
  }
  public static void Remove(string target) {
    if (!CredDeleteW(target, 1, 0)) throw new Exception("CredDelete failed " + Marshal.GetLastWin32Error());
  }
}
'@
if (-not ('NativeCred' -as [type])) { Add-Type -TypeDefinition $src -Language CSharp }
switch ($Action.ToLower()) {
  'read'   { $b = [NativeCred]::ReadBlob($Target); [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($b)) }
  'user'   { [Console]::Out.Write([NativeCred]::ReadUser($Target)) }
  'write'  { $bytes = [System.IO.File]::ReadAllBytes($BlobPath); [NativeCred]::Write($Target, $UserName, $bytes); 'ok' }
  'delete' { [NativeCred]::Remove($Target); 'ok' }
  default  { throw "unknown action $Action" }
}