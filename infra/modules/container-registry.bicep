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

@description('Optional. Enable private networking. Forces the Premium SKU, disables public network access and creates a private endpoint for the registry.')
param enablePrivateNetworking bool = false

@description('Optional. Enable scalability. Bumps the registry to the Premium SKU (WAF-aligned) to allow geo-replication and higher throughput.')
param enableScalability bool = false

@description('Optional. Resource ID of the subnet to host the registry private endpoint. Required when enablePrivateNetworking is true.')
param privateEndpointSubnetResourceId string = ''

@description('Optional. Resource ID of the privatelink.azurecr.io private DNS zone. Required when enablePrivateNetworking is true.')
param privateDnsZoneResourceId string = ''

import { managedIdentityAllType } from 'br/public:avm/utl/types/avm-common-types:0.7.0'
@description('Optional. The managed identity definition for this resource.')
param managedIdentities managedIdentityAllType?

// AcrPull role: allows the App Service / Container Instance identities to pull images.
var acrPullRoleDefinitionId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

// Premium is required for private endpoints, and recommended (WAF) for scalability.
var effectiveAcrSku = (enablePrivateNetworking || enableScalability) ? 'Premium' : acrSku

var pullRoleAssignments = [
  for principalId in pullPrincipalIds: {
    principalId: principalId
    roleDefinitionIdOrName: acrPullRoleDefinitionId
    principalType: 'ServicePrincipal'
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
    acrSku: effectiveAcrSku
    acrAdminUserEnabled: false
    anonymousPullEnabled: false
    azureADAuthenticationAsArmPolicyStatus: 'enabled'
    exportPolicyStatus: 'enabled'
    softDeletePolicyStatus: 'disabled'
    softDeletePolicyDays: 7
    publicNetworkAccess: enablePrivateNetworking ? 'Disabled' : 'Enabled'
    networkRuleBypassOptions: enablePrivateNetworking ? 'AzureServices' : null
    networkRuleSetDefaultAction: enablePrivateNetworking ? 'Deny' : 'Allow'
    roleAssignments: pullRoleAssignments
    managedIdentities: managedIdentities
    privateEndpoints: enablePrivateNetworking
      ? [
          {
            name: 'pep-${name}'
            customNetworkInterfaceName: 'nic-${name}'
            service: 'registry'
            subnetResourceId: privateEndpointSubnetResourceId
            privateDnsZoneGroup: {
              privateDnsZoneGroupConfigs: [
                { privateDnsZoneResourceId: privateDnsZoneResourceId }
              ]
            }
          }
        ]
      : []
  }
}

@description('The name of the Container Registry.')
output name string = containerRegistry.outputs.name

@description('The resource ID of the Container Registry.')
output resourceId string = containerRegistry.outputs.resourceId

@description('The login server URL of the Container Registry.')
output loginServer string = containerRegistry.outputs.loginServer
