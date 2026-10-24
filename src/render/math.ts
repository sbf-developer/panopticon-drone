import * as THREE from 'three';
import type { Quat } from '../core/math/quat';
import type { Vec3 } from '../core/math/vec3';

export const vecToThree = (vector: Vec3): THREE.Vector3 =>
  new THREE.Vector3(vector.x, vector.y, vector.z);

export const quatToThree = (quaternion: Quat): THREE.Quaternion =>
  new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

export const setVec = (target: THREE.Vector3, vector: Vec3): void => {
  target.set(vector.x, vector.y, vector.z);
};

export const setQuat = (target: THREE.Quaternion, quaternion: Quat): void => {
  target.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
};
