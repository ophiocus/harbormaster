# toast.ps1 - best-effort Windows toast. Dot-source it, then call Show-Toast.
#
# Deliberately best-effort and wrapped in try/catch: the LOG is the source of
# truth, a toast is a courtesy. A notifier that throws because the toast API
# moved would take the whole report down with it.
#
# Requires Windows PowerShell 5.1 - the WindowsRuntime ContentType load does not
# work on PowerShell 7, which is why the scheduled task calls powershell.exe.

function Show-Toast {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$Body
    )
    try {
        [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
        [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]

        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        $tmpl = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
            [Windows.UI.Notifications.ToastTemplateType]::ToastText02)

        $texts = $tmpl.GetElementsByTagName('text')
        $texts.Item(0).AppendChild($tmpl.CreateTextNode($Title)) | Out-Null
        $texts.Item(1).AppendChild($tmpl.CreateTextNode($Body)) | Out-Null

        $toast = [Windows.UI.Notifications.ToastNotification]::new($tmpl)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    } catch {
        # Swallowed on purpose; the caller has already written the log.
        Write-Verbose ("toast failed: " + $_.Exception.Message)
    }
}
