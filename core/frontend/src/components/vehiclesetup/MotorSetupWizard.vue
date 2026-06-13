<template>
  <v-dialog v-model="dialog" max-width="860px">
    <template #activator="{ on, attrs }">
      <v-btn color="primary" outlined v-bind="attrs" v-on="on">
        <v-icon left>
          mdi-auto-fix
        </v-icon>
        Setup wizard
      </v-btn>
    </template>
    <v-card class="pa-4">
      <v-card-title class="text-h6">
        Motor setup wizard
        <v-spacer />
        <v-btn icon @click="dialog = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-stepper v-model="step" vertical flat>
        <!-- Step 1: intro / safety -->
        <v-stepper-step :complete="step > 1" step="1">
          Get ready
        </v-stepper-step>
        <v-stepper-content step="1">
          <p class="text-body-2">
            This wizard spins each output port one at a time so you can match the
            <strong>physical thruster that moves</strong> to the position your frame expects.
            It then proposes the parameter changes to fix any swapped wiring, and lets you
            correct spin directions.
          </p>
          <p class="text-body-2">
            Detected frame: <strong>{{ frameName }}</strong> ({{ expectedThrusters.length }} thrusters)
          </p>
          <v-alert dense text type="warning" class="my-2">
            Thrusters will spin. Vehicle should be in water (or props removed), armed, and in Manual mode.
          </v-alert>
          <v-btn color="primary" :disabled="!canTest || motorPorts.length === 0" @click="startIdentify">
            Start
          </v-btn>
          <span v-if="!canTest" class="ml-3 text-caption grey--text">
            Arm the vehicle in Manual mode to enable.
          </span>
          <span v-else-if="motorPorts.length === 0" class="ml-3 text-caption grey--text">
            No motor outputs assigned yet — assign motors on the port board first.
          </span>
        </v-stepper-content>

        <!-- Step 2: identify each port's physical thruster -->
        <v-stepper-step :complete="step > 2" step="2">
          Identify thrusters
        </v-stepper-step>
        <v-stepper-content step="2">
          <div v-if="currentPort !== undefined">
            <p class="text-body-2 mb-1">
              Port <strong>{{ currentPort.servo }}</strong> ({{ currentIndex + 1 }}/{{ motorPorts.length }})
              — press <em>Spin</em>, then click the position of the thruster that moved.
            </p>
            <v-btn small color="primary" class="mb-3" :loading="spinning" @click="spinCurrent">
              <v-icon left small>
                mdi-fan
              </v-icon>
              Spin port {{ currentPort.servo }}
            </v-btn>
            <!-- Frame diagram: top-down thruster positions -->
            <svg viewBox="-110 -110 220 220" class="frame-diagram">
              <rect x="-55" y="-80" width="110" height="160" rx="18" class="body-outline" />
              <g
                v-for="thruster in expectedThrusters"
                :key="thruster.motor"
                :transform="`translate(${thruster.x}, ${thruster.y})`"
                class="thruster"
                :class="{ identified: identifiedMotors.includes(thruster.motor) }"
                role="button"
                tabindex="0"
                @click="identifyCurrent(thruster.motor)"
                @keydown.enter="identifyCurrent(thruster.motor)"
              >
                <circle r="16" />
                <text y="-20" text-anchor="middle" class="thruster-label">{{ thruster.label }}</text>
                <text y="5" text-anchor="middle" class="thruster-motor">M{{ thruster.motor }}</text>
              </g>
            </svg>
            <p class="text-caption grey--text">
              Vertical thrusters are shown inside the body outline. Already-identified positions are dimmed.
            </p>
          </div>
        </v-stepper-content>

        <!-- Step 3: review + apply remap -->
        <v-stepper-step :complete="step > 3" step="3">
          Review wiring fixes
        </v-stepper-step>
        <v-stepper-content step="3">
          <div v-if="proposedChanges.length === 0">
            <v-alert dense text type="success" class="my-2">
              Wiring matches the frame — no parameter changes needed.
            </v-alert>
          </div>
          <div v-else>
            <p class="text-body-2">
              The following outputs are wired to a different position than assigned:
            </p>
            <v-simple-table dense>
              <tbody>
                <tr v-for="change in proposedChanges" :key="change.servo">
                  <td>Port {{ change.servo }}</td>
                  <td>currently Motor {{ change.currentMotor }}</td>
                  <td>→ physically <strong>Motor {{ change.actualMotor }}</strong></td>
                </tr>
              </tbody>
            </v-simple-table>
            <v-btn color="primary" class="mt-3" @click="applyChanges">
              Apply {{ proposedChanges.length }} change(s)
            </v-btn>
          </div>
          <v-btn text class="mt-3" @click="step = 4">
            {{ proposedChanges.length === 0 ? 'Continue' : 'Skip' }}
          </v-btn>
        </v-stepper-content>

        <!-- Step 4: directions -->
        <v-stepper-step step="4">
          Check spin directions
        </v-stepper-step>
        <v-stepper-content step="4">
          <p class="text-body-2">
            Spin each motor <em>forward</em>. If the thruster pushes the wrong way, flip its direction.
          </p>
          <div v-for="port in motorPorts" :key="'dir' + port.servo" class="d-flex align-center my-1">
            <span class="mr-2" style="min-width: 130px;">Port {{ port.servo }} (Motor {{ port.motor }})</span>
            <v-btn x-small outlined color="primary" class="mr-2" @click="spinPort(port)">
              <v-icon left x-small>
                mdi-fan
              </v-icon>
              Spin
            </v-btn>
            <parameter-switch
              v-if="directionParam(port.motor)"
              :parameter="directionParam(port.motor)"
              :on-value="-1.0"
              :off-value="1.0"
              label="Reversed"
            />
          </div>
          <v-btn color="success" class="mt-3" @click="dialog = false">
            Done
          </v-btn>
        </v-stepper-content>
      </v-stepper>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import Vue from 'vue'

import mavlink2rest from '@/libs/MAVLink2Rest'
import autopilot_data from '@/store/autopilot'
import Parameter, { printParam } from '@/types/autopilot/parameter'
import { FRAME_CONFIG, SERVO_FUNCTION } from '@/types/autopilot/parameter-sub-enums'
import { doMotorTest } from '@/utils/ardupilot_mavlink'

import ParameterSwitch from '../common/ParameterSwitch.vue'

const SPIN_TEST_PWM = 1600

/** A motor-assigned output port. */
interface MotorPort {
  servo: number // output port number (SERVOn)
  motor: number // currently assigned motor function number
  param: Parameter
}

/** An expected thruster position for the frame diagram. */
interface ExpectedThruster {
  motor: number
  label: string
  x: number
  y: number
}

// Top-down diagram positions (x right, y down; vehicle nose up) per ArduSub frame.
const VECTORED_LAYOUT: ExpectedThruster[] = [
  {
    motor: 1, label: 'Front-Right', x: 70, y: -60,
  },
  {
    motor: 2, label: 'Front-Left', x: -70, y: -60,
  },
  {
    motor: 3, label: 'Rear-Right', x: 70, y: 60,
  },
  {
    motor: 4, label: 'Rear-Left', x: -70, y: 60,
  },
  {
    motor: 5, label: 'Vert-Right', x: 30, y: 0,
  },
  {
    motor: 6, label: 'Vert-Left', x: -30, y: 0,
  },
]

const VECTORED_6DOF_LAYOUT: ExpectedThruster[] = [
  {
    motor: 1, label: 'Front-Right', x: 70, y: -60,
  },
  {
    motor: 2, label: 'Front-Left', x: -70, y: -60,
  },
  {
    motor: 3, label: 'Rear-Right', x: 70, y: 60,
  },
  {
    motor: 4, label: 'Rear-Left', x: -70, y: 60,
  },
  {
    motor: 5, label: 'Vert-FR', x: 30, y: -35,
  },
  {
    motor: 6, label: 'Vert-FL', x: -30, y: -35,
  },
  {
    motor: 7, label: 'Vert-RR', x: 30, y: 35,
  },
  {
    motor: 8, label: 'Vert-RL', x: -30, y: 35,
  },
]

export default Vue.extend({
  name: 'MotorSetupWizard',
  components: {
    ParameterSwitch,
  },
  props: {
    canTest: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      dialog: false,
      step: 1,
      currentIndex: 0,
      spinning: false,
      // port servo number -> physically observed motor number
      observed: {} as Record<number, number>,
    }
  },
  computed: {
    frameValue(): number | undefined {
      return autopilot_data.parameter('FRAME_CONFIG')?.value
    },
    frameName(): string {
      const param = autopilot_data.parameter('FRAME_CONFIG')
      return param ? printParam(param) : 'Unknown'
    },
    expectedThrusters(): ExpectedThruster[] {
      if (this.frameValue === FRAME_CONFIG.VECTORED_6DOF || this.frameValue === FRAME_CONFIG.VECTORED_6DOF_90) {
        return VECTORED_6DOF_LAYOUT
      }
      // Default to the 6-thruster vectored layout (also a sane fallback for custom frames).
      return VECTORED_LAYOUT
    },
    motorPorts(): MotorPort[] {
      return autopilot_data
        .parameterRegex('^SERVO(\\d+)_FUNCTION$')
        .filter((p: Parameter) => p.value >= SERVO_FUNCTION.MOTOR1 && p.value <= SERVO_FUNCTION.MOTOR8)
        .map((p: Parameter) => ({
          servo: parseInt(/\d+/g.exec(p.name)?.[0] ?? '0', 10),
          motor: p.value - SERVO_FUNCTION.MOTOR1 + 1,
          param: p,
        }))
        .sort((a: MotorPort, b: MotorPort) => a.servo - b.servo)
    },
    currentPort(): MotorPort | undefined {
      return this.motorPorts[this.currentIndex]
    },
    identifiedMotors(): number[] {
      return Object.values(this.observed)
    },
    proposedChanges(): { servo: number; currentMotor: number; actualMotor: number }[] {
      return this.motorPorts
        .filter((port) => this.observed[port.servo] !== undefined && this.observed[port.servo] !== port.motor)
        .map((port) => ({ servo: port.servo, currentMotor: port.motor, actualMotor: this.observed[port.servo] }))
    },
  },
  methods: {
    startIdentify(): void {
      this.observed = {}
      this.currentIndex = 0
      this.step = 2
    },
    spinCurrent(): void {
      if (this.currentPort) this.spinPort(this.currentPort)
    },
    spinPort(port: MotorPort): void {
      if (!this.canTest) return
      // MOTOR_TEST targets are zero-indexed motor numbers; runs ~1 second.
      doMotorTest(port.motor - 1, SPIN_TEST_PWM)
      this.spinning = true
      setTimeout(() => {
        this.spinning = false
      }, 1000)
    },
    identifyCurrent(motorNumber: number): void {
      if (!this.currentPort) return
      this.$set(this.observed, this.currentPort.servo, motorNumber)
      if (this.currentIndex < this.motorPorts.length - 1) {
        this.currentIndex += 1
      } else {
        this.step = 3
      }
    },
    applyChanges(): void {
      for (const change of this.proposedChanges) {
        const port = this.motorPorts.find((p) => p.servo === change.servo)
        if (!port) continue
        const newFunction = SERVO_FUNCTION.MOTOR1 + change.actualMotor - 1
        mavlink2rest.setParam(port.param.name, newFunction, autopilot_data.system_id, port.param.paramType.type)
      }
      autopilot_data.reset()
      this.step = 4
    },
    directionParam(motorNumber: number): Parameter | undefined {
      return autopilot_data.parameter(`MOT_${motorNumber}_DIRECTION`)
    },
  },
})
</script>

<style scoped>
.frame-diagram {
  width: 320px;
  max-width: 100%;
  display: block;
}
.body-outline {
  fill: none;
  stroke: #90a4ae;
  stroke-width: 2;
  opacity: 0.6;
}
.thruster {
  cursor: pointer;
}
.thruster circle {
  fill: #1976d2;
  opacity: 0.85;
  transition: opacity 0.1s, fill 0.1s;
}
.thruster:hover circle {
  fill: #42a5f5;
}
.thruster.identified circle {
  fill: #607d8b;
  opacity: 0.35;
}
.thruster-label {
  font-size: 9px;
  fill: currentcolor;
}
.thruster-motor {
  font-size: 11px;
  font-weight: 700;
  fill: #fff;
}
</style>
