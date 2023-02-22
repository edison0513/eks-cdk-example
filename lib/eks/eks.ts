import cdk = require('aws-cdk-lib');
import ec2 = require('aws-cdk-lib/aws-ec2');
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import elb = require('aws-cdk-lib/aws-elasticloadbalancingv2');
import { Vpc } from '../vpc/vpc';
import yaml = require('js-yaml');
import fs = require('fs');



export class EksStack extends cdk.Stack {


    constructor(scope: cdk.App, id: string, props: cdk.StackProps) {
        super(scope, id, props);

        const vpc = ec2.Vpc.fromLookup(this, 'ExistingVPC', { vpcName: 'vpc' });

        const mastersRole = new iam.Role(this, 'AdminRole', {
            assumedBy: new iam.AccountRootPrincipal()
        });

        const cluster = new eks.Cluster(this, 'cluster', {
            clusterName: 'cluster',
            version: eks.KubernetesVersion.V1_21,
            vpc,
            mastersRole,
            vpcSubnets: [{ subnetType: ec2.SubnetType.PUBLIC }],
            defaultCapacity: 0,
            endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE
        });

        cluster.addNodegroupCapacity('public-workernode', {
            nodegroupName: 'worknode-public',
            subnets: { subnetType: ec2.SubnetType.PUBLIC },
            instanceTypes: [ new ec2.InstanceType('t3.small') ],
            minSize: 1,
        })
        
        cluster.addNodegroupCapacity('private-workernode', {
            nodegroupName: 'worknode-private',
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
            instanceTypes: [ new ec2.InstanceType('t3.medium') ],
            minSize: 1,

        })
        
        // spot instance        
        // cluster.addAutoScalingGroupCapacity('spot-workernode', {
        //     vpcSubnets:{ subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
        //     instanceType: [ new ec2.InstanceType('t3.medium') ],
        //     maxInstanceLifetime: cdk.Duration.days(7),
        //     spotPrice: 0.1,
        //     minCapacity: 1,
        // })

        cluster.awsAuth.addRoleMapping(mastersRole, {
            username: 'masterRole',
            groups: ['system:masters']
        });

        // const eks_admin_role = iam.Role.fromRoleArn(this, 'eks-admin',
        //     "arn:aws:iam::069140953284:role/OrganizationAccountAccessRole",
        //     {mutable: false}
        // );
        // cluster.awsAuth.addRoleMapping(eks_admin_role, {
        //     groups: ['system:masters']
        // });

        // Patch aws-node daemonset to use IRSA via EKS Addons, do before nodes are created
        // https://aws.github.io/aws-eks-best-practices/security/docs/iam/#update-the-aws-node-daemonset-to-use-irsa
        const awsNodeTrustPolicy = new cdk.CfnJson(this, 'aws-node-trust-policy', {
            value: {
                [`${cluster.openIdConnectProvider.openIdConnectProviderIssuer}:aud`]: 'sts.amazonaws.com',
                [`${cluster.openIdConnectProvider.openIdConnectProviderIssuer}:sub`]: 'system:serviceaccount:kube-system:aws-node',
            },
        });
        const awsNodePrincipal = new iam.OpenIdConnectPrincipal(cluster.openIdConnectProvider).withConditions({
            StringEquals: awsNodeTrustPolicy,
        });
        const awsNodeRole = new iam.Role(this, 'aws-node-role', {
            assumedBy: awsNodePrincipal
        })

        awsNodeRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'))



        // Addons
        new eks.CfnAddon(this, 'vpc-cni', {
            addonName: 'vpc-cni',
            resolveConflicts: 'OVERWRITE',
            clusterName: cluster.clusterName,
            serviceAccountRoleArn: awsNodeRole.roleArn
        });
        new eks.CfnAddon(this, 'kube-proxy', {
            addonName: 'kube-proxy',
            resolveConflicts: 'OVERWRITE',
            clusterName: cluster.clusterName,
        });
        new eks.CfnAddon(this, 'core-dns', {
            addonName: 'coredns',
            resolveConflicts: 'OVERWRITE',
            clusterName: cluster.clusterName,
        });



        ///////////////////////////////////
        // install AWS load balancer via Helm charts
        const iamIngressPolicyDocument = JSON.parse(fs.readFileSync('files/iam/aws-lb-controller-v2.3.0-iam-policy.json').toString());
        const iamIngressPolicy = new iam.Policy(this, 'aws-load-balancer-controller-policy', {
            policyName: 'AWSLoadBalancerControllerIAMPolicy',
            document: iam.PolicyDocument.fromJson(iamIngressPolicyDocument),
        })

        const sa = cluster.addServiceAccount('aws-load-balancer-controller', {
            name: 'aws-load-balancer-controller',
            namespace: 'kube-system',
        });
        // cluster.awsAuth.addMastersRole(sa.role!);
        sa.role.attachInlinePolicy(iamIngressPolicy);

        const awsLoadBalancerControllerChart = cluster.addHelmChart('aws-loadbalancer-controller', {
            chart: 'aws-load-balancer-controller',
            repository: 'https://aws.github.io/eks-charts',
            namespace: 'kube-system',
            release: 'aws-load-balancer-controller',
            version: '1.4.5', // mapping to v2.4.4
            wait: true,
            timeout: cdk.Duration.minutes(15),
            values: {
                clusterName: cluster.clusterName,
                serviceAccount: {
                    create: false,
                    name: sa.serviceAccountName,
                },
                // must disable waf features for aws-cn partition
                enableShield: false,
                enableWaf: false,
                enableWafv2: false,
            },
        });
        // awsLoadBalancerControllerChart.node.addDependency(cluster.addNodegroupCapacity);
        awsLoadBalancerControllerChart.node.addDependency(sa);
        awsLoadBalancerControllerChart.node.addDependency(cluster.openIdConnectProvider);

        new cdk.CfnOutput(this, 'mastersRoleArn', {
            value: mastersRole.roleArn,
            description: 'The ARN of the cluster role',
            exportName: 'mastersRole',
        });

    }
}