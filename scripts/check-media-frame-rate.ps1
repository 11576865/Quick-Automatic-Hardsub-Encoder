$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../windows/media-frame-rate.ps1')
$before=[Threading.Thread]::CurrentThread.CurrentCulture
try{
    foreach($culture in @('en-US','de-DE','zh-CN')){
        [Threading.Thread]::CurrentThread.CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo($culture)
        foreach($case in @(@('12/1',12.0),@('30000/1001',(30000.0/1001)),@('23.976',23.976),@('0/1',0.0))){
            if([Math]::Abs((Convert-MediaFrameRate $case[0])-[double]$case[1]) -gt 0.000001){throw 'Rational frame rate conversion differs.'}
        }
        foreach($invalid in @('1/0','NaN','1e9','23,976','1001/1')){
            $rejected=$false;try{[void](Convert-MediaFrameRate $invalid)}catch{$rejected=$true}
            if(-not $rejected){throw 'Invalid FPS was accepted.'}
        }
    }
}finally{[Threading.Thread]::CurrentThread.CurrentCulture=$before}
Write-Host 'Media rational FPS parsing passed under three cultures.'
