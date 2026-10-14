// B14: observational compute/size/quality evidence from completed, source-paired
// Windows Native CQ samples. This is NOT a whole-movie time estimate, an
// interchangeable ASS reference, a VBR certificate, or an adoption policy.
import {normalizeManualComparisonProtocol} from './manual-transcode-comparison.js';

const finite = n => typeof n==='number' && Number.isFinite(n);
const closeness=(a,b)=>Math.abs(a-b);
const matched=(x,y,tolerance=.003)=>closeness(x.minimumSsim,y.minimumSsim)<=tolerance &&
  closeness(x.averageSsim,y.averageSsim)<=tolerance;

export function summarizeManualEncodeCost(trials,{referenceVideoBitrate=null,maxDisplayedCandidates=12}={}){
  if(!Array.isArray(trials)||trials.length<2||trials.length>12||
    !Number.isSafeInteger(maxDisplayedCandidates)||maxDisplayedCandidates<1||maxDisplayedCandidates>12||
    (referenceVideoBitrate!==null&&(!finite(referenceVideoBitrate)||referenceVideoBitrate<=0)))
    return {ok:false,reason:'invalid-cost-comparison'};
  const baseline=normalizeManualComparisonProtocol(trials[0]?.protocol);
  if(!baseline.ok)return {ok:false,reason:'invalid-cost-protocol'};
  const scope=baseline.scope,windows=baseline.protocol.windows,ids=new Set(),points=[];
  const available=[];
  for(const t of trials){
    const p=normalizeManualComparisonProtocol(t?.protocol);
    if(!p.ok||p.scope!==scope)return {ok:false,reason:'incompatible-cost-protocol'};
    const candidate=t.candidate;
    if(!candidate||typeof candidate.id!=='string'||!candidate.id.trim()||
      ids.has(candidate.id)||!Array.isArray(t.points)||t.points.length>12)
      return {ok:false,reason:'invalid-cost-candidate'};
    ids.add(candidate.id);
    const entries=[];
    for(const point of t.points){
      // The original Native session only publishes a complete CQ point; this
      // independent adapter additionally refuses malformed/incomplete evidence.
      if(!Number.isSafeInteger(point?.qualitySetting)||point.qualitySetting<0||
        point.qualitySetting>63||!finite(point.sampleBitrate)||point.sampleBitrate<=0||
        !finite(point.ssim)||point.ssim<0||point.ssim>1||
        !finite(point.averageSsim)||point.averageSsim<0||point.averageSsim>1||
        !Array.isArray(point.sampleMeasurements)||point.sampleMeasurements.length!==windows.length)
        continue;
      const measured=[...point.sampleMeasurements].sort((a,b)=>a.start-b.start);
      if(measured.some((m,i)=>!finite(m?.start)||closeness(m.start,windows[i].start)>.001||
         !finite(m.duration)||m.duration<=0||
         closeness(m.duration,windows[i].duration)>Math.max(.10,windows[i].duration*.025)||
         !finite(m.bitrate)||m.bitrate<=0||!finite(m.ssim)||m.ssim<0||m.ssim>1||
         !finite(m.elapsedSeconds)||m.elapsedSeconds<=0))continue;
      const aggregateMin=Math.min(...measured.map(m=>m.ssim));
      const aggregateMean=measured.reduce((sum,m)=>sum+m.ssim,0)/measured.length;
      const aggregateRate=measured.reduce((sum,m)=>sum+m.bitrate,0)/measured.length;
      if(closeness(aggregateMin,point.ssim)>1e-5||
        closeness(aggregateMean,point.averageSsim)>1e-5||
        closeness(aggregateRate,point.sampleBitrate)>Math.max(1,aggregateRate*.0001))
        continue;
      const mediaSeconds=measured.reduce((sum,m)=>sum+m.duration,0);
      const encodeSeconds=measured.reduce((sum,m)=>sum+m.elapsedSeconds,0);
      if(!(mediaSeconds>0&&encodeSeconds>0))continue;
      entries.push(Object.freeze({
        candidateId:candidate.id,codec:candidate.codec,encoder:candidate.encoder,
        preset:candidate.preset,qualitySetting:point.qualitySetting,
        minimumSsim:point.ssim,averageSsim:point.averageSsim,
        measuredVideoBitrate:point.sampleBitrate,
        measuredMediaSeconds:mediaSeconds,measuredEncodeSeconds:encodeSeconds,
        speedFactor:mediaSeconds/encodeSeconds,
        minimumWindowSpeedFactor:Math.min(...measured.map(m=>m.duration/m.elapsedSeconds)),
        maximumWindowSpeedFactor:Math.max(...measured.map(m=>m.duration/m.elapsedSeconds)),
        measuredWindows:measured.length,
        timeBasis:'windows-native-ffmpeg-encode-stopwatch-v1',
        scope:'paired-cq-windows-only'
      }));
    }
    entries.sort((a,b)=>a.qualitySetting-b.qualitySetting);
    available.push(...entries);
    const target=referenceVideoBitrate;
    const nearest=entries.length ? [...entries].sort((a,b)=>{
      const da=target?Math.abs(Math.log(a.measuredVideoBitrate/target)):Math.abs(a.qualitySetting-28);
      const db=target?Math.abs(Math.log(b.measuredVideoBitrate/target)):Math.abs(b.qualitySetting-28);
      return da-db||a.qualitySetting-b.qualitySetting;
    })[0] : null;
    points.push({
      candidateId:candidate.id,availableQualitySettings:entries.length,
      measuredSettings:entries,
      nearestObserved:nearest,
      referenceRateDeltaPercent:nearest&&target?
        Math.round((nearest.measuredVideoBitrate/target-1)*10000)/100:null,
      mayPredictWholeFileSeconds:false,canRankUnmeasuredTarget:false
    });
  }
  if(!available.length)return {ok:false,reason:'no-complete-timing-evidence'};
  // Matching quality is only an explicit near-match on the *same* windows;
  // it is never relabelled as identical quality or equal output size.
  const pairs=[];
  for(let i=0;i<available.length;i++){
    for(let j=i+1;j<available.length;j++){
      const a=available[i],b=available[j];
      if(a.candidateId===b.candidateId||!matched(a,b))continue;
      const qualityDistance=Math.max(
        closeness(a.minimumSsim,b.minimumSsim),
        closeness(a.averageSsim,b.averageSsim)
      );
      pairs.push({
        candidateA:a.candidateId,candidateB:b.candidateId,
        qualitySettingA:a.qualitySetting,qualitySettingB:b.qualitySetting,
        minimumSsimA:a.minimumSsim,minimumSsimB:b.minimumSsim,
        videoBitrateA:a.measuredVideoBitrate,videoBitrateB:b.measuredVideoBitrate,
        encodeSecondsA:a.measuredEncodeSeconds,encodeSecondsB:b.measuredEncodeSeconds,
        timeRatioAOverB:a.measuredEncodeSeconds/b.measuredEncodeSeconds,
        videoRateRatioAOverB:a.measuredVideoBitrate/b.measuredVideoBitrate,
        qualityDistance,pairedWindows:a.measuredWindows,
        exactQualityEquivalence:false,wholeMoviePrediction:false
      });
    }
  }
  pairs.sort((x,y)=>x.qualityDistance-y.qualityDistance||
    String(x.candidateA).localeCompare(String(y.candidateA)));
  return {
    ok:true,kind:'manual-native-measured-time-size-quality-v1',
    evidenceScope:scope,timeBasis:'windows-native-ffmpeg-encode-stopwatch-v1',
    measuredWindowCount:windows.length,
    candidates:points.slice(0,maxDisplayedCandidates),
    candidatesOmitted:Math.max(0,points.length-maxDisplayedCandidates),
    matchedQualityPairs:pairs.slice(0,8),
    matchedPairsOmitted:Math.max(0,pairs.length-8),
    referenceVideoBitrate,
    limitations:[
      'time-measures-only-matched-windows',
      'no-full-movie-time-forecast',
      'no-SSIM-quality-equivalence-certificate',
      'no-automatic-codec-adoption',
      'no-timing-based-ranking-of-interpolated-target'
    ]
  };
}
