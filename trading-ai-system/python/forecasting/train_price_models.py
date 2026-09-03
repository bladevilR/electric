import argparse, hashlib, json, platform
from datetime import datetime, timezone
from pathlib import Path
import joblib, numpy as np, sklearn
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import ElasticNetCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from model_contract import validate_training_row
def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--dataset',required=True); parser.add_argument('--output',required=True); parser.add_argument('--model-id',default='day_ahead_price_multifactor'); args=parser.parse_args()
    raw=Path(args.dataset).read_bytes(); rows=[validate_training_row(json.loads(line)) for line in raw.decode().splitlines() if line.strip()]; fit=[r for r in rows if r['split'] in ('train','validation')]; features=sorted(set.intersection(*(set(r['features']) for r in fit))); X=np.array([[float(r['features'][k]) for k in features] for r in fit]); y=np.array([float(r['target']) for r in fit])
    models={'point':Pipeline([('scale',StandardScaler()),('model',ElasticNetCV(cv=min(5,max(2,len(fit)//2)),random_state=0))])}; models.update({f'p{int(q*100)}':GradientBoostingRegressor(loss='quantile',alpha=q,random_state=0) for q in (.1,.5,.9)}); [model.fit(X,y) for model in models.values()]
    out=Path(args.output); out.mkdir(parents=True,exist_ok=True); artifact=out/'models.joblib'; joblib.dump({'models':models,'features':features},artifact); digest=hashlib.sha256(artifact.read_bytes()).hexdigest(); manifest={'modelId':args.model_id,'modelVersion':digest[:16],'trainedAt':datetime.now(timezone.utc).isoformat(),'trainingDatasetSha256':hashlib.sha256(raw).hexdigest(),'featureCatalogVersion':1,'featureList':features,'targetField':rows[0].get('targetField','unknown'),'trainingStartDate':min(r['date'] for r in fit),'trainingEndDate':max(r['date'] for r in fit),'validationDates':sorted({r['date'] for r in fit if r['split']=='validation'}),'pythonVersion':platform.python_version(),'libraryVersions':{'numpy':np.__version__,'scikit-learn':sklearn.__version__,'joblib':joblib.__version__},'artifactSha256':digest,'promotionStatus':'candidate_only'}; (out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
if __name__=='__main__': main()
