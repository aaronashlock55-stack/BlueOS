import bag from '@/store/bag'
import { Dictionary } from '@/types/common'

// Persisted on the vehicle via the bag-of-holding key-value service so names follow the vehicle.
export const MOTOR_NAMES_BAG_PATH = 'blueos-2-0/motor-config'

export async function loadMotorNames(): Promise<Dictionary<string>> {
  const stored = await bag.getData(MOTOR_NAMES_BAG_PATH)
  const names = stored?.names
  if (names && typeof names === 'object') {
    return names as Dictionary<string>
  }
  return {}
}

export async function saveMotorNames(names: Dictionary<string>): Promise<boolean> {
  return bag.setData(MOTOR_NAMES_BAG_PATH, { names })
}
