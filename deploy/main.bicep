// ===================================================================
//  Azure VM สำหรับรันเว็บออตโต้บอท + HiveMQ broker ในเครื่องเดียว
//
//  สร้างด้วย:
//    az group create -n rg-ottobot -l southeastasia
//    az deployment group create -g rg-ottobot -f main.bicep \
//        --parameters dnsLabel=ottobot-xxxx sshPublicKey="$(cat ~/.ssh/id_ed25519.pub)" \
//                     allowedSshSourceIp="<IP ของคุณ>/32"
// ===================================================================

@description('ชื่อย่อที่ใช้ตั้งชื่อ resource ทั้งหมด')
param appName string = 'ottobot'

@description('ภูมิภาค - southeastasia (สิงคโปร์) ใกล้ไทยที่สุด latency ต่ำสุด')
param location string = resourceGroup().location

@description('ชื่อ DNS ต้องไม่ซ้ำกับใครในภูมิภาคนั้น จะได้ชื่อเต็มเป็น <dnsLabel>.<region>.cloudapp.azure.com')
@minLength(3)
@maxLength(45)
param dnsLabel string

@description('ชื่อผู้ใช้สำหรับ SSH เข้าเครื่อง')
param adminUsername string = 'azureuser'

@description('กุญแจสาธารณะ SSH เช่นเนื้อหาของ ~/.ssh/id_ed25519.pub')
@secure()
param sshPublicKey string

@description('IP ที่อนุญาตให้ SSH เข้าได้ ใส่เป็น CIDR เช่น 203.0.113.5/32 ไม่แนะนำให้ใช้ * ')
param allowedSshSourceIp string

@description('ขนาดเครื่อง B2s = 2 vCPU / 4 GB เหมาะกับ Next.js + HiveMQ (JVM กินแรมพอตัว)')
param vmSize string = 'Standard_B2s'

@description('ขนาดดิสก์ระบบ (GB)')
param osDiskSizeGb int = 32

var tags = {
  'app-name': appName
  environment: 'prod'
  owner: adminUsername
  'managed-by': 'bicep'
}

// ---------------------------------------------------------------- เครือข่าย

resource nsg 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: '${appName}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        // จำกัดให้ SSH เข้าได้จาก IP ของคุณเท่านั้น พอร์ต 22 ที่เปิดทั้งโลกจะถูกยิงรหัสตลอดเวลา
        name: 'allow-ssh'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: allowedSshSourceIp
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
        }
      }
      {
        // พอร์ต 80 จำเป็นสำหรับให้ Let's Encrypt ตรวจสอบโดเมน และ redirect ไป https
        name: 'allow-http'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '80'
        }
      }
      {
        // หน้าเว็บจริง ต้องเป็น https ไม่งั้นเบราว์เซอร์ไม่ให้ใช้ไมโครโฟน
        name: 'allow-https'
        properties: {
          priority: 120
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
      {
        // ช่องที่หุ่นใช้ต่อเข้า HiveMQ แบบเข้ารหัส
        name: 'allow-mqtt-tls'
        properties: {
          priority: 130
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '8883'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: '${appName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.20.0.0/16'] }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: '10.20.1.0/24'
          networkSecurityGroup: { id: nsg.id }
        }
      }
    ]
  }
}

resource publicIp 'Microsoft.Network/publicIPAddresses@2023-11-01' = {
  name: '${appName}-ip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    // ได้ชื่อโดเมนฟรีจาก Azure ใช้ขอใบรับรอง HTTPS ได้ ไม่ต้องซื้อโดเมน
    dnsSettings: { domainNameLabel: dnsLabel }
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2023-11-01' = {
  name: '${appName}-nic'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: { id: vnet.properties.subnets[0].id }
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: { id: publicIp.id }
        }
      }
    ]
  }
}

// ------------------------------------------------------------------ เครื่อง

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: '${appName}-vm'
  location: location
  tags: tags
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: '${appName}-vm'
      adminUsername: adminUsername
      linuxConfiguration: {
        // ปิดการล็อกอินด้วยรหัสผ่าน ใช้กุญแจ SSH เท่านั้น
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
        patchSettings: {
          patchMode: 'AutomaticByPlatform'
          assessmentMode: 'ImageDefault'
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-jammy'
        sku: '22_04-lts-gen2'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        diskSizeGB: osDiskSizeGb
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
        deleteOption: 'Delete'
      }
    }
    networkProfile: {
      networkInterfaces: [{ id: nic.id }]
    }
    diagnosticsProfile: {
      bootDiagnostics: { enabled: true }
    }
  }
}

// ------------------------------------------------------------------ ผลลัพธ์

output fqdn string = publicIp.properties.dnsSettings.fqdn
output publicIpAddress string = publicIp.properties.ipAddress
output sshCommand string = 'ssh ${adminUsername}@${publicIp.properties.dnsSettings.fqdn}'
output webUrl string = 'https://${publicIp.properties.dnsSettings.fqdn}'
output mqttUrlForRobot string = 'mqtts://${publicIp.properties.dnsSettings.fqdn}:8883'
