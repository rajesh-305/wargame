pipeline {
  agent any

  options {
    ansiColor('xterm')
    timestamps()
    disableConcurrentBuilds()
  }

  environment {
    APP_NAME = 'b2-bomber'
    DOCKERHUB_REPO = 'yourdockerhubuser/b2-bomber'

    SONARQUBE_SERVER = 'sonarqube-server'

    STAGING_STACK_NAME = 'b2-bomber-staging'
    STAGING_SWARM_MANAGER = 'docker-swarm-manager.example.com'

    ARGOCD_SERVER = 'argocd.example.com'
    ARGOCD_APP = 'b2-bomber-prod'

    GIT_USER_EMAIL = 'jenkins@local'
    GIT_USER_NAME = 'jenkins-bot'
    GIT_TARGET_BRANCH = 'main'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install Dependencies') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Build App') {
      steps {
        sh 'npm run build || echo "No build script found, skipping app build"'
      }
    }

    stage('SonarQube Code Analysis') {
      steps {
        withSonarQubeEnv("${SONARQUBE_SERVER}") {
          sh 'sonar-scanner -Dsonar.qualitygate.wait=false'
        }
      }
    }

    stage('Code Quality Gate') {
      steps {
        timeout(time: 15, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }

    stage('Trivy Filesystem Scan') {
      steps {
        sh 'trivy fs --no-progress --severity HIGH,CRITICAL --exit-code 1 .'
      }
    }

    stage('Build Docker Image') {
      steps {
        script {
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${env.GIT_COMMIT.take(7)}"
          env.FULL_IMAGE = "${env.DOCKERHUB_REPO}:${env.IMAGE_TAG}"
          env.LATEST_IMAGE = "${env.DOCKERHUB_REPO}:latest"
        }
        sh 'docker build -t ${FULL_IMAGE} -t ${LATEST_IMAGE} .'
      }
    }

    stage('Trivy Image Scan') {
      steps {
        sh 'trivy image --no-progress --severity HIGH,CRITICAL --exit-code 1 ${FULL_IMAGE}'
      }
    }

    stage('Push Image to Docker Hub') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'dockerhub-creds', usernameVariable: 'DOCKER_USER', passwordVariable: 'DOCKER_PASS')]) {
          sh '''
            echo "${DOCKER_PASS}" | docker login -u "${DOCKER_USER}" --password-stdin
            docker push "${FULL_IMAGE}"
            docker push "${LATEST_IMAGE}"
            docker logout
          '''
        }
      }
    }

    stage('Deploy to Staging (Docker Swarm)') {
      steps {
        sshagent(credentials: ['staging-swarm-ssh']) {
          withCredentials([string(credentialsId: 'staging-session-secret', variable: 'SESSION_SECRET')]) {
            sh '''
              scp deploy/docker-stack.staging.yml ${STAGING_SWARM_MANAGER}:/tmp/docker-stack.staging.yml
              ssh ${STAGING_SWARM_MANAGER} "export IMAGE=${FULL_IMAGE}; export SESSION_SECRET=${SESSION_SECRET}; docker stack deploy -c /tmp/docker-stack.staging.yml ${STAGING_STACK_NAME}"
            '''
          }
        }
      }
    }

    stage('Promote to Production via Argo CD') {
      when {
        branch 'main'
      }
      steps {
        input message: 'Promote this build to production?', ok: 'Deploy'

        withCredentials([usernamePassword(credentialsId: 'git-push-creds', usernameVariable: 'GIT_USER', passwordVariable: 'GIT_PASS')]) {
          sh '''
            git config user.email "${GIT_USER_EMAIL}"
            git config user.name "${GIT_USER_NAME}"

            sed -i "s|image: .*|image: docker.io/${DOCKERHUB_REPO#*/}:${IMAGE_TAG}|" k8s/prod/stateful-app.yaml

            git add k8s/prod/stateful-app.yaml
            git commit -m "ci: promote image to ${IMAGE_TAG}" || true

            REPO_URL=$(git config --get remote.origin.url)
            CLEAN_URL=${REPO_URL#https://}
            git push https://${GIT_USER}:${GIT_PASS}@${CLEAN_URL} HEAD:${GIT_TARGET_BRANCH}
          '''
        }

        withCredentials([string(credentialsId: 'argocd-auth-token', variable: 'ARGOCD_AUTH_TOKEN')]) {
          sh '''
            argocd --server ${ARGOCD_SERVER} --grpc-web --auth-token ${ARGOCD_AUTH_TOKEN} app sync ${ARGOCD_APP}
            argocd --server ${ARGOCD_SERVER} --grpc-web --auth-token ${ARGOCD_AUTH_TOKEN} app wait ${ARGOCD_APP} --health --sync --timeout 600
          '''
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'k8s/prod/stateful-app.yaml,argocd/application-prod.yaml,deploy/docker-stack.staging.yml', onlyIfSuccessful: false
    }
    success {
      echo 'Pipeline completed successfully.'
    }
    failure {
      echo 'Pipeline failed. Check logs for failed stage details.'
    }
  }
}
