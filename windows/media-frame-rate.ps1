function Convert-MediaFrameRate($Value){
    $text=([string]$Value).Trim()
    if(-not $text){return 0.0}
    if($text -cnotmatch '^(\d+(?:\.\d+)?)(?:/(\d+(?:\.\d+)?))?$'){throw 'Invalid media frame rate.'}
    $n=[double]::Parse($Matches[1],[Globalization.CultureInfo]::InvariantCulture)
    $d=if($Matches[2]){[double]::Parse($Matches[2],[Globalization.CultureInfo]::InvariantCulture)}else{1.0}
    if($d -le 0){throw 'Invalid media frame rate denominator.'}
    $rate=$n/$d
    if([double]::IsInfinity($rate) -or [double]::IsNaN($rate) -or $rate -gt 1000){throw 'Invalid media frame rate range.'}
    return $rate
}
