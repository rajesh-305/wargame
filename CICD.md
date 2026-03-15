# CI/CD Pipeline (Jenkins + SonarQube + Trivy + Docker Hub + Swarm + Argo CD)

This project now includes a Jenkins pipeline in `Jenkinsfile` that performs:

1. Build app
2. SonarQube code analysis
3. Quality gate check
4. Trivy filesystem scan
5. Docker image build
6. Trivy image scan
7. Push image to Docker Hub
8. Deploy to Docker Swarm (staging)
9. Promote to production with Argo CD (Kubernetes)

## Files Added

- `Jenkinsfile`
- `sonar-project.properties`
- `deploy/docker-stack.staging.yml`
- `k8s/prod/stateful-app.yaml`
- `argocd/application-prod.yaml`

## Jenkins Plugins Required

- Pipeline
- SonarQube Scanner for Jenkins
- SSH Agent
- Credentials Binding
- Docker Pipeline (optional but recommended)

## Tools Required on Jenkins Agent

- Node.js + npm
- Docker CLI
- sonar-scanner CLI
- trivy CLI
- argocd CLI
- ssh and scp

## Jenkins Credentials Required

- `dockerhub-creds` (Username with password)
- `staging-swarm-ssh` (SSH private key)
- `staging-session-secret` (Secret text)
- `git-push-creds` (Username with password for git push)
- `argocd-auth-token` (Secret text)

## One-Time Setup

1. Update image namespace in:
   - `Jenkinsfile` -> `DOCKERHUB_REPO`
   - `k8s/prod/stateful-app.yaml` -> image field

2. Update staging server host:
   - `Jenkinsfile` -> `STAGING_SWARM_MANAGER`

3. Update Argo CD values:
   - `Jenkinsfile` -> `ARGOCD_SERVER`, `ARGOCD_APP`
   - `argocd/application-prod.yaml` -> `repoURL`, `path`, destination namespace

4. Apply Argo CD app (one time):

```bash
kubectl apply -f argocd/application-prod.yaml
```

5. Ensure production cluster contains required secret:

```bash
kubectl create secret generic bomber-secret \
  --from-literal=SESSION_SECRET='<strong-random-secret>'
```

## How Promotion Works

- Jenkins builds and scans a versioned image tag.
- Jenkins deploys that tag to Swarm staging.
- On main branch, Jenkins asks for manual approval.
- After approval, Jenkins updates `k8s/prod/stateful-app.yaml` image tag and pushes commit.
- Jenkins triggers Argo CD sync and waits for healthy/synced state.

## Notes

- The production deployment remains stateful with a Kubernetes StatefulSet.
- Current app storage backend is SQLite, so keep replicas at 1 unless migrating to Postgres/Redis.
