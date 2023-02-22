#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Vpc } from '../lib/vpc/vpc';
import {EksStack } from '../lib/eks/eks';
const app = new cdk.App();
const env = {
    account: '069140953284' ,
    region: 'ap-southeast-1'
  };
new Vpc(app, 'Vpc', { env });

new EksStack(app, 'EksStack', { env });



app.synth();