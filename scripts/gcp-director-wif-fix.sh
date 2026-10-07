#!/usr/bin/env bash
# Apply production GCP fixes for Director Cloud Run ADK + Firestore past briefs.
# Requires: gcloud authenticated with permission on creative-ai-491118.
#
# Fixes:
# 1) Caller SA Token Creator on itself → iam.serviceAccounts.getOpenIdToken for :generateIdToken
# 2) Caller SA run.invoker on the ADK Cloud Run service
# 3) Named Firestore DB creative-director-1 (if missing)
# 4) Caller SA roles/datastore.user for Firestore REST
#
# Usage:
#   ./scripts/gcp-director-wif-fix.sh
#   ADK_SERVICE=creative-director ./scripts/gcp-director-wif-fix.sh
#   DRY_RUN=1 ./scripts/gcp-director-wif-fix.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-creative-ai-491118}"
SA_EMAIL="${GCP_SERVICE_ACCOUNT_EMAIL:-vercel@creative-ai-491118.iam.gserviceaccount.com}"
FIRESTORE_DB="${FIRESTORE_DATABASE_ID:-creative-director-1}"
FIRESTORE_LOCATION="${FIRESTORE_LOCATION:-nam5}"
ADK_REGION="${ADK_REGION:-us-east1}"
ADK_SERVICE="${ADK_SERVICE:-creative-director}"
DRY_RUN="${DRY_RUN:-0}"

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "+ $*"
    return 0
  fi
  "$@"
}

echo "Project:     $PROJECT_ID"
echo "Caller SA:   $SA_EMAIL"
echo "Firestore:   $FIRESTORE_DB ($FIRESTORE_LOCATION)"
echo "Cloud Run:   $ADK_SERVICE ($ADK_REGION)"
echo

echo "==> Token Creator self-bind (getOpenIdToken for Cloud Run ID tokens)"
run gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator"

echo "==> Cloud Run invoker for ADK"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "+ gcloud run services describe $ADK_SERVICE --region=$ADK_REGION --project=$PROJECT_ID"
  echo "+ gcloud run services add-iam-policy-binding $ADK_SERVICE --region=$ADK_REGION --project=$PROJECT_ID --member=serviceAccount:${SA_EMAIL} --role=roles/run.invoker"
elif gcloud run services describe "$ADK_SERVICE" \
  --region="$ADK_REGION" \
  --project="$PROJECT_ID" \
  --format='value(metadata.name)' >/dev/null 2>&1; then
  run gcloud run services add-iam-policy-binding "$ADK_SERVICE" \
    --region="$ADK_REGION" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/run.invoker"
else
  echo "WARN: Cloud Run service '$ADK_SERVICE' not found in $ADK_REGION."
  echo "      Set ADK_SERVICE to the service behind DIRECTOR_ADK_BASE_URL and re-run."
fi

echo "==> Firestore named database"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "+ gcloud firestore databases describe --database=$FIRESTORE_DB --project=$PROJECT_ID"
  echo "+ gcloud firestore databases create --database=$FIRESTORE_DB --location=$FIRESTORE_LOCATION --project=$PROJECT_ID --type=firestore-native (if missing)"
elif gcloud firestore databases describe "--database=$FIRESTORE_DB" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Firestore database '$FIRESTORE_DB' already exists."
else
  echo "Creating Firestore database '$FIRESTORE_DB' in $FIRESTORE_LOCATION..."
  run gcloud firestore databases create \
    "--database=$FIRESTORE_DB" \
    "--location=$FIRESTORE_LOCATION" \
    --project="$PROJECT_ID" \
    --type=firestore-native
fi

echo "==> datastore.user for caller SA"
run gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/datastore.user" \
  --condition=None

echo
echo "Done. Next:"
echo "  1) Retry POST /api/director on create.creativeplatform.xyz (expect no getOpenIdToken 403)."
echo "  2) Retry GET /api/director-sessions (expect no creative-director-1 404)."
echo "  3) If list queries ask for an index: director_sessions wallet ASC, updatedAt DESC."
