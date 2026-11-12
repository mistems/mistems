<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span><span v-if="federated" v-tooltip="tooltip">🪐 </span>{{ channel.name }}</span>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { i18n } from '@/i18n.js';
import { isFederatedChannel } from '@/utility/channel.js';

const props = defineProps<{
	channel: {
		name: string;
		federationPolicy?: 'none' | 'home' | 'public';
	};
}>();

const federated = computed(() => isFederatedChannel(props.channel));
const tooltip = computed(() => {
	const policy = props.channel.federationPolicy ?? 'none';
	return policy === 'none' ? '' : i18n.ts._channel._federationPolicy[policy];
});
</script>
