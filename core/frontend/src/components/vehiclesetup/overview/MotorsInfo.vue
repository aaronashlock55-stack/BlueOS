<template>
  <v-card class="pa-2">
    <v-card-title class="align-center">
      <v-icon left>
        mdi-fan
      </v-icon>
      Motors
    </v-card-title>
    <v-card-text v-if="motors.length === 0">
      Not configured
    </v-card-text>
    <v-card-text v-else>
      <span
        v-for="motor in motors"
        :key="motor.port"
        class="d-block"
      >
        <v-icon>
          mdi-dots-horizontal
        </v-icon>
        Output {{ motor.port }} - {{ motor.label }}
      </span>
    </v-card-text>
  </v-card>
</template>

<script lang="ts">
import Vue from 'vue'

import { loadMotorNames } from '@/components/vehiclesetup/motor-names'
import autopilot_data from '@/store/autopilot'
import Parameter, { printParam } from '@/types/autopilot/parameter'
import { SERVO_FUNCTION } from '@/types/autopilot/parameter-sub-enums'
import { Dictionary } from '@/types/common'

interface MotorEntry {
  port: number
  label: string
}

export default Vue.extend({
  name: 'MotorsInfo',
  data() {
    return {
      motor_names: {} as Dictionary<string>,
    }
  },
  computed: {
    motors(): MotorEntry[] {
      return autopilot_data.parameterRegex('^SERVO(\\d+)_FUNCTION$')
        .filter(
          (parameter: Parameter) => parameter.value >= SERVO_FUNCTION.MOTOR1
            && parameter.value <= SERVO_FUNCTION.MOTOR8,
        )
        .map((parameter: Parameter) => {
          const port = parseInt(/\d+/g.exec(parameter.name)?.[0] ?? '0', 10)
          const custom_name = this.motor_names[port]
          const label = custom_name ? `${custom_name} (${printParam(parameter)})` : printParam(parameter)
          return { port, label }
        })
        .sort((a: MotorEntry, b: MotorEntry) => a.port - b.port)
    },
  },
  async mounted() {
    this.motor_names = await loadMotorNames()
  },
})
</script>
