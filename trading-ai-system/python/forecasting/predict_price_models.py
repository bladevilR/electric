import argparse, json, joblib
from pathlib import Path
from model_contract import emit
def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--model',required=True); parser.add_argument('--snapshot',required=True); args=parser.parse_args(); root=Path(args.model); bundle=joblib.load(root/'models.joblib'); manifest=json.loads((root/'manifest.json').read_text()); snapshot=json.loads(Path(args.snapshot).read_text()); rows=[]
    for row in snapshot.get('rows',[]):
        X=[[float(row.get('fields',row)[key]) for key in bundle['features']]]; p10,p50,p90=[float(bundle['models'][key].predict(X)[0]) for key in ('p10','p50','p90')]; warnings=[]
        if not p10<=p50<=p90: p10,p50,p90=sorted((p10,p50,p90)); warnings.append('quantile_crossing_corrected')
        rows.append({'pointIndex':row['pointIndex'],'pointForecast':float(bundle['models']['point'].predict(X)[0]),'p10':p10,'p50':p50,'p90':p90,'modelId':manifest['modelId'],'modelVersion':manifest['modelVersion'],'featureSnapshotId':snapshot.get('featureSnapshotId'),'warnings':warnings})
    emit({'rows':rows})
if __name__=='__main__': main()
