import cdk = require('aws-cdk-lib');
import ec2 = require('aws-cdk-lib/aws-ec2');



export class Vpc extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props: cdk.StackProps) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, 'Vpc', {
            cidr: '10.2.0.0/16',
            maxAzs: 2,
            natGateways: 1,
            subnetConfiguration: [
                {
                    name: "vpc-PublicSubnet-1",
                    cidrMask: 20,
                    subnetType: ec2.SubnetType.PUBLIC
                },
                {
                  name: "vpc-PrivateSubnet-1",
                  cidrMask: 20,
                  subnetType: ec2.SubnetType.PRIVATE_WITH_NAT
                }
            ]
        });
//     // update the Name tag for the VPC
    cdk.Aspects.of(vpc).add(new cdk.Tag('Name', 'vpc'));

//     // update the Name tag for public subnets
    for (const subnet of vpc.publicSubnets) {
      cdk.Aspects.of(subnet).add(
        new cdk.Tag(
          'Name',
          `${subnet.node.id.replace(/Subnet[0-9]$/, '')}-${
            subnet.availabilityZone
          }`,
        ),
      );
    }

    // // update the Name tag for private subnets
    for (const subnet of vpc.privateSubnets) {
      cdk.Aspects.of(subnet).add(
        new cdk.Tag(
          'Name',
          `${subnet.node.id.replace(/Subnet[0-9]$/, '')}-${
            subnet.availabilityZone
          }`,
        ),
      );
    }
    }
}