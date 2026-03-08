#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ChimeAiMeetingStack } from '../lib/chime-ai-meeting-stack';

const app = new cdk.App();

new ChimeAiMeetingStack(app, 'ChimeAiMeetingStack', {
  env: {
    region: 'ap-northeast-1',
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  description: 'Amazon Chime SDK + Bedrock Claude による AI ビデオ会議システム',
});
