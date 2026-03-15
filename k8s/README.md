# Kubernetes Stateful Deployment

This app now persists state in `/app/data`:
- `game.db` for game and user data (SQLite)
- `sessions.db` for Express session storage

The `StatefulSet` in `stateful-app.yaml` mounts a per-pod persistent volume at `/app/data`.

## Important limitation

SQLite uses a local file and is best operated with **one replica** in Kubernetes.
For multi-replica or high availability, move state to an external database (for example PostgreSQL) and use a shared session store (for example Redis).

## Deploy

1. Build and push your image:

```bash
docker build -t your-registry/b2-bomber:v1.0.0 .
docker push your-registry/b2-bomber:v1.0.0
```

2. Create secret:

```bash
kubectl apply -f k8s/secret.example.yaml
```

3. Deploy app:

```bash
kubectl apply -f k8s/stateful-app.yaml
```

4. Verify:

```bash
kubectl get pods
kubectl get pvc
kubectl get svc
```

5. Local access via port-forward:

```bash
kubectl port-forward svc/bomber-app 3000:80
```

Then open `http://localhost:3000`.
