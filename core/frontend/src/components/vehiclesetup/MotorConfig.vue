<template>
  <div class="motor-config pa-3">
    <v-row>
      <v-col cols="12" md="5">
        <v-card class="pa-2">
          <vehicle-viewer :highlight="highlight" :transparent="true" :autorotate="false" />
          <div class="text-center text-caption grey--text pb-2">
            Click a port to assign a motor. Hover to locate it on the vehicle.
            Arm in Manual mode and use a port's <strong>Spin</strong> button
            to confirm the physical thruster before locking in.
          </div>
        </v-card>
      </v-col>
      <v-col cols="12" md="7">
        <div class="d-flex align-center flex-wrap mb-2">
          <span class="text-subtitle-1 font-weight-bold">
            Navigator PWM Outputs
          </span>
          <v-spacer />
          <v-switch
            v-model="desired_armed_state"
            :loading="desired_armed_state !== is_armed ? 'warning' : null"
            :disabled="!is_manual"
            class="mx-2 my-0 flex-grow-0"
            hide-details
            :label="arm_disarm_switch_label"
            :color="`${is_armed ? 'error' : 'success'}`"
            @change="armDisarmSwitchChange"
          />
          <motor-setup-wizard :can-test="can_test" class="mr-2" />
          <motor-detection />
        </div>
        <v-row dense>
          <v-col
            v-for="param in servo_function_parameters"
            :key="param.name"
            cols="6"
            sm="4"
          >
            <v-card
              class="port-card pa-2"
              :class="{ assigned: isMotor(param) }"
              outlined
              @click="openEditor(param)"
              @mouseover="highlightMotor(param)"
              @mouseleave="highlight = default_highlight"
            >
              <div class="d-flex justify-space-between align-center">
                <span class="port-badge">Port {{ portNumber(param) }}</span>
                <v-icon small>
                  {{ isMotor(param) ? 'mdi-fan' : 'mdi-pencil-outline' }}
                </v-icon>
              </div>
              <div class="function-label" :class="{ unassigned: !isMotor(param) }">
                {{ friendlyFunction(param) }}
              </div>
              <v-btn
                v-if="isMotor(param)"
                v-tooltip="can_test
                  ? 'Briefly spin this thruster to confirm the wiring'
                  : 'Arm the vehicle in Manual mode to enable spin tests'"
                x-small
                block
                outlined
                color="primary"
                class="mt-1"
                :disabled="!can_test"
                :loading="spinning_port === portNumber(param)"
                @click.stop="spinMotor(param)"
              >
                <v-icon left x-small>
                  mdi-fan
                </v-icon>
                Spin
              </v-btn>
              <v-text-field
                v-if="isMotor(param)"
                :value="motor_names[portNumber(param)]"
                placeholder="Name this motor"
                dense
                hide-details
                class="name-field mt-1"
                @click.stop
                @change="(name) => saveName(portNumber(param), name)"
              />
              <div class="v-progress-linear mt-2" style="height: 14px;">
                <div class="pwm-bar-bg" />
                <div class="pwm-bar" :style="styleForMotorBar(live_output(portNumber(param)))" />
                <div class="pwm-bar-content">
                  <small>{{ pwmPercent(live_output(portNumber(param))) }}%</small>
                </div>
              </div>
            </v-card>
          </v-col>
        </v-row>
        <div v-if="servo_function_parameters.length === 0" class="grey--text mt-4">
          No SERVOn_FUNCTION parameters available. Connect to a vehicle to configure motors.
        </div>
      </v-col>
    </v-row>
    <servo-function-editor-dialog
      v-if="edit_param_dialog"
      v-model="edit_param_dialog"
      :param="selected_param"
    />
  </div>
</template>

<script lang="ts">
import Vue from 'vue'

import ServoFunctionEditorDialog from '@/components/parameter-editor/ServoFunctionEditorDialog.vue'
import { loadMotorNames, saveMotorNames } from '@/components/vehiclesetup/motor-names'
import MotorDetection from '@/components/vehiclesetup/MotorDetection.vue'
import MotorSetupWizard from '@/components/vehiclesetup/MotorSetupWizard.vue'
import VehicleViewer from '@/components/vehiclesetup/viewers/VehicleViewer.vue'
import {
  MavModeFlag,
} from '@/libs/MAVLink2Rest/mavlink2rest-ts/messages/mavlink2rest-enum'
import { Message } from '@/libs/MAVLink2Rest/mavlink2rest-ts/messages/mavlink2rest-message'
import autopilot_data from '@/store/autopilot'
import mavlink from '@/store/mavlink'
import Parameter, { printParam } from '@/types/autopilot/parameter'
import { SERVO_FUNCTION } from '@/types/autopilot/parameter-sub-enums'
import { Dictionary } from '@/types/common'
import { armDisarm, doMotorTest } from '@/utils/ardupilot_mavlink'
import mavlink_store_get from '@/utils/mavlink'

// Gentle forward pulse (~10% throttle) used to identify a thruster.
const SPIN_TEST_PWM = 1600

export default Vue.extend({
  name: 'MotorConfig',
  components: {
    ServoFunctionEditorDialog,
    VehicleViewer,
    MotorDetection,
    MotorSetupWizard,
  },
  data() {
    return {
      highlight: ['Motor', 'Light', 'Mount', 'Gripper'],
      default_highlight: ['Motor', 'Light', 'Mount', 'Gripper'],
      edit_param_dialog: false,
      selected_param: undefined as Parameter | undefined,
      motor_names: {} as Dictionary<string>,
      desired_armed_state: false,
      spinning_port: 0,
      spin_reset_timer: undefined as undefined | number,
    }
  },
  computed: {
    servo_function_parameters(): Parameter[] {
      return autopilot_data.parameterRegex('^SERVO(\\d+)_FUNCTION$').sort(
        (a: Parameter, b: Parameter) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
      )
    },
    motor_outputs(): Dictionary<number> {
      const data = mavlink_store_get(mavlink, 'SERVO_OUTPUT_RAW.messageData.message') as Dictionary<number>
      const outputs = {} as Dictionary<number>
      if (!data) {
        return outputs
      }
      for (const [key, value] of Object.entries(data)) {
        if (!key.includes('servo')) continue
        outputs[parseInt(key.replace('servo', '').replace('_raw', ''), 10)] = value
      }
      return outputs
    },
    heartbeat(): Message.Heartbeat {
      return mavlink_store_get(
        mavlink,
        'HEARTBEAT.messageData.message',
        autopilot_data.system_id,
        1,
      ) as Message.Heartbeat
    },
    is_armed(): boolean {
      return Boolean(this.heartbeat?.base_mode.bits & MavModeFlag.MAV_MODE_FLAG_SAFETY_ARMED)
    },
    is_manual(): boolean {
      // Legacy manual mode
      if (!(this.heartbeat?.base_mode.bits & MavModeFlag.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)) {
        return Boolean(this.heartbeat?.base_mode.bits & MavModeFlag.MAV_MODE_FLAG_MANUAL_INPUT_ENABLED)
      }
      const sub_custom_mode_manual = 19
      return Boolean(this.heartbeat?.custom_mode === sub_custom_mode_manual)
    },
    can_test(): boolean {
      return this.is_armed && this.is_manual
    },
    arm_disarm_switch_label(): string {
      let label = `${this.is_armed ? 'Armed' : 'Disarmed'}`
      if (!this.is_manual) {
        label += ' - Vehicle needs to be in Manual Mode'
      }
      return label
    },
  },
  watch: {
    is_armed() {
      // To reflect changes made from other sources like from GCSs
      this.desired_armed_state = this.is_armed
    },
  },
  async mounted() {
    mavlink.setMessageRefreshRate({ messageName: 'SERVO_OUTPUT_RAW', refreshRate: 10 })
    this.desired_armed_state = this.is_armed
    await this.loadNames()
  },
  beforeDestroy() {
    mavlink.setMessageRefreshRate({ messageName: 'SERVO_OUTPUT_RAW', refreshRate: 1 })
    clearTimeout(this.spin_reset_timer)
  },
  methods: {
    portNumber(param: Parameter): number {
      return parseInt(/\d+/g.exec(param.name)?.[0] ?? '0', 10)
    },
    isMotor(param: Parameter): boolean {
      return param.value >= SERVO_FUNCTION.MOTOR1 && param.value <= SERVO_FUNCTION.MOTOR8
    },
    friendlyFunction(param: Parameter): string {
      return param.options?.[param.value] ?? printParam(param)
    },
    highlightMotor(param: Parameter): void {
      if (this.isMotor(param)) {
        const motor_number = param.value - SERVO_FUNCTION.MOTOR1 + 1
        this.highlight = [`Motor${motor_number}`]
      }
    },
    openEditor(param: Parameter): void {
      this.selected_param = param
      this.edit_param_dialog = true
    },
    live_output(servo: number): number {
      return this.motor_outputs[servo] ?? 1500
    },
    pwmPercent(value: number): number {
      return Math.round((value - 1500) / 10)
    },
    styleForMotorBar(value: number): string {
      const percent = this.pwmPercent(value)
      const left = percent < 0 ? 50 + percent : 50
      return `width: ${Math.abs(percent)}%; left: ${left}%; background-color: red`
    },
    async loadNames(): Promise<void> {
      this.motor_names = await loadMotorNames()
    },
    async saveName(servo: number, name: string): Promise<void> {
      this.$set(this.motor_names, servo, name)
      await saveMotorNames(this.motor_names)
    },
    spinMotor(param: Parameter): void {
      if (!this.can_test || !this.isMotor(param)) {
        return
      }
      // MOTOR_TEST targets are zero-indexed motor numbers; runs for 1 second.
      const target = param.value - SERVO_FUNCTION.MOTOR1
      doMotorTest(target, SPIN_TEST_PWM)
      this.spinning_port = this.portNumber(param)
      clearTimeout(this.spin_reset_timer)
      this.spin_reset_timer = setTimeout(() => {
        this.spinning_port = 0
      }, 1000)
    },
    armDisarmSwitchChange(should_arm: boolean): void {
      armDisarm(should_arm, true).catch(() => {
        this.desired_armed_state = this.is_armed
        console.warn(`${should_arm ? 'Arming' : 'Disarming'} failed!`)
      })
    },
  },
})
</script>

<style scoped>
.port-card {
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.port-card:hover {
  border-color: var(--v-primary-base);
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.25);
}
.port-card.assigned {
  border-left: 4px solid var(--v-primary-base);
}
.port-badge {
  font-size: 0.75rem;
  font-weight: 700;
  opacity: 0.7;
}
.function-label {
  font-size: 0.95rem;
  font-weight: 600;
  margin-top: 2px;
}
.function-label.unassigned {
  opacity: 0.5;
  font-weight: 400;
}
.name-field {
  font-size: 0.85rem;
}
.pwm-bar-content {
  align-items: center;
  display: flex;
  height: 100%;
  left: 0;
  justify-content: center;
  position: absolute;
  top: 0;
  width: 100%;
}
.pwm-bar {
  height: inherit;
  left: 0;
  position: absolute;
  transition: none;
}
.pwm-bar-bg {
  bottom: 0;
  left: 0;
  position: absolute;
  top: 0;
  opacity: 0.3;
  width: 100%;
  background-color: rgb(195, 195, 195);
}
</style>
