using './main.bicep'

param AZURE_LOCATION = readEnvironmentVariable('AZURE_LOCATION', '')
param environmentName = readEnvironmentVariable('AZURE_ENV_NAME', 'env_name')
param secondaryLocation = readEnvironmentVariable('AZURE_ENV_SECONDARY_LOCATION', 'eastus2')
param deploymentType = readEnvironmentVariable('AZURE_ENV_MODEL_DEPLOYMENT_TYPE', 'GlobalStandard')
param gptModelName = readEnvironmentVariable('AZURE_ENV_MODEL_NAME', 'gpt-4o')
param gptDeploymentCapacity = int(readEnvironmentVariable('AZURE_ENV_MODEL_CAPACITY', '30'))

param embeddingDeploymentCapacity = int(readEnvironmentVariable('AZURE_ENV_EMBEDDING_MODEL_CAPACITY', '80'))
