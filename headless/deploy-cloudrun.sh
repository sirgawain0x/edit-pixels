#!/usr/bin/env bash
# Deploy Pixels headless render service to Cloud Run (Phase 2 assembly).
# Run from edit-pixels repo root:
#   PIXELS_API_KEY="$(openssl rand -hex 24)" ./headless/deploy-cloudrun.sh
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-creative-ai-491118}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${PIXELS_HEADLESS_SERVICE:-pixels-headless}"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE}"
API_KEY="${PIXELS_API_KEY:?Set PIXELS_API_KEY (also used as PIXELS_HEADLESS_API_KEY on the agent)}"

echo "Building ${IMAGE}..."
gcloud builds submit --project "${PROJECT_ID}" \
  --config headless/cloudbuild.yaml \
  --substitutions=_IMAGE="${IMAGE}" \
  .

echo "Deploying Cloud Run service ${SERVICE}..."
gcloud run deploy "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 2 \
  --timeout 3600 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "PIXELS_HOST=0.0.0.0,PIXELS_API_KEY=${API_KEY}" \
  --port 8787

URL="$(gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"
echo ""
echo "Headless URL: ${URL}"
echo "Set on Agent Engine:"
echo "  PIXELS_HEADLESS_URL=${URL}"
echo "  PIXELS_HEADLESS_API_KEY=${API_KEY}"
