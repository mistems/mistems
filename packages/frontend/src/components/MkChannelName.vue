<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span><span v-if="federated" v-tooltip="tooltip" role="img" :aria-label="tooltip">🪐 </span>{{ channel.name }}</span>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { i18n } from '@/i18n.js';
import { isFederatedChannel } from '@/utility/channel.js';

const props = defineProps<{
	channel: {
		name: string;
		federationPolicy?: 'none' | 'public';
	};
}>();

const federated = computed(() => isFederatedChannel(props.channel));
const tooltip = computed(() => federated.value ? i18n.ts._channel._federationPolicy.public : '');
</script>
