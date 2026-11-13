<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span><i v-if="federated" v-tooltip="tooltip" class="ti ti-whirl" :class="$style.icon" role="img" :aria-label="tooltip"></i>{{ channel.name }}</span>
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

<style lang="scss" module>
.icon {
	margin-right: 4px;
}
</style>
