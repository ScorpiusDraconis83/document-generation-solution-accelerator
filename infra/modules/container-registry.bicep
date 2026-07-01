// ========== container-registry.bicep ========== //
// Azure Container Registry module.
// Provisions an ACR and grants AcrPull to the frontend/backend identities so the
// App Service and Container Instance can pull application images once they are
// built and pushed by a post-deployment step.

@description('Required. Name of the Azure Container Registry.')
param name string

@description('Optional. Location for the Container Registry.')
param location string = resourceGroup().location

@description('Optional. Tags for all resources.')
param tags object = {}

@description('Optional. Enable/Disable usage telemetry for module.')
param enableTelemetry bool = true

@description('Optional. SKU for the Container Registry.')
@allowed([
  'Basic'
  'Standard'
  'Premium'
])
param acrSku string = 'Standard'

@description('Optional. Principal IDs (frontend/backend managed identities) that require AcrPull access.')
param pullPrincipalIds array = []

@description('Optional. Principal IDs (e.g. the deployer) that require AcrPush access to build and push images.')
param pushPrincipalIds array = []

@description('Optional. Principal type for the AcrPush role assignments.')
@allowed([
  'User'
  'Group'
  'ServicePrincipal'
])
param pushPrincipalType string = 'User'

import { managedIdentityAllType } from 'br/public:avm/utl/types/avm-common-types:0.7.0'
@description('Optional. The managed identity definition for this resource.')
param managedIdentities managedIdentityAllType?

// AcrPull role: allows the App Service / Container Instance identities to pull images.
var acrPullRoleDefinitionId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
// AcrPush role: allows the deployer to build and push images to the registry.
var acrPushRoleDefinitionId = '8311e382-0749-4cb8-b61a-304f252e45ec'

var pullRoleAssignments = [
  for principalId in pullPrincipalIds: {
    principalId: principalId
    roleDefinitionIdOrName: acrPullRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
]

var pushRoleAssignments = [
  for principalId in pushPrincipalIds: {
    principalId: principalId
    roleDefinitionIdOrName: acrPushRoleDefinitionId
    principalType: pushPrincipalType
  }
]

// ========== Azure Container Registry ========== //
module containerRegistry 'br/public:avm/res/container-registry/registry:0.9.0' = {
  name: take('avm.res.container-registry.registry.${name}', 64)
  params: {
    name: name
    location: location
    tags: tags
    enableTelemetry: enableTelemetry
    acrSku: acrSku
    acrAdminUserEnabled: false
    anonymousPullEnabled: false
    publicNetworkAccess: 'Enabled'
    networkRuleBypassOptions: 'AzureServices'
    roleAssignments: concat(pullRoleAssignments, pushRoleAssignments)
    managedIdentities: managedIdentities
  }
}

@description('The name of the Container Registry.')
output name string = containerRegistry.outputs.name

@description('The resource ID of the Container Registry.')
output resourceId string = containerRegistry.outputs.resourceId

@description('The login server URL of the Container Registry.')
output loginServer string = containerRegistry.outputs.loginServer
