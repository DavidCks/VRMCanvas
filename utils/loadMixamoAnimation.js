import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { mixamoVRMRigMap } from './mixamoVRMRigMap.js';
import { motionVRMRigMap } from './motionVRMRigMap.js';
import { bvhVRMRigMap } from './bvhVRMRigMap.js';

/**
 * Load Mixamo animation, convert for three-vrm use, and return it.
 *
 * @param {string} url A url of mixamo animation data
 * @param {VRM} vrm A target VRM
 * @returns {Promise<THREE.AnimationClip>} The converted AnimationClip
 */
export function loadMixamoAnimation( url, vrm, onProgress ) {
	var loader;
	if ( url.endsWith( ".bvh" ) ) {
		loader = new BVHLoader(); // A loader which loads BVH
	} else {
		 loader = new FBXLoader(); // A loader which loads FBX
	}

	return loader.loadAsync( url, onProgress ).then( ( asset ) => {
		let clip;
		let animationSpeed;
		if ( asset.clip?.name === "animation" ) {
			animationSpeed = .25;
			clip = asset.clip;
			clip.duration /= animationSpeed;
		} else {
			animationSpeed = 1;
			clip = asset.animations.find( ( e ) => [ "mixamo.com", "Motion" ].includes( e.name ) );// extract the AnimationClip
		}

		const tracks = []; // KeyframeTracks compatible with VRM will be added here

		const restRotationInverse = new THREE.Quaternion();
		const parentRestWorldRotation = new THREE.Quaternion();
		const _quatA = new THREE.Quaternion();
		const _vec3 = new THREE.Vector3();

		// Adjust with reference to hips height.
		let motionHipsHeight;
		if ( typeof asset.getObjectByName === "undefined" ) {
			motionHipsHeight = asset.skeleton.bones.find( ( bone ) => bone.name === "Hips" ).position.y;
			if ( motionHipsHeight === 0 ) {
				const modelBones = asset.skeleton.bones;
				const lowerBodyParts = [
					modelBones.find( ( e ) => e.name === "RightUpLeg" ),
					modelBones.find( ( e ) => e.name === "RightLeg" ),
					modelBones.find( ( e ) => e.name === "RightFoot" ),
					modelBones.find( ( e ) => e.name === "RightToeBase" ),
				];
				let lowerBodyHeight = 0;
				lowerBodyParts.forEach( ( e ) => lowerBodyHeight += e.position.y );
				motionHipsHeight = lowerBodyHeight * - 1;
			}
		} else {
			motionHipsHeight = asset.getObjectByName( 'mixamorigHips' )?.position.y ?? 2;
		}

		const vrmHipsY = vrm.humanoid?.getNormalizedBoneNode( 'hips' ).getWorldPosition( _vec3 ).y;
		const vrmRootY = vrm.scene.getWorldPosition( _vec3 ).y;
		const vrmHipsHeight = Math.abs( vrmHipsY - vrmRootY );
		const hipsPositionScale = vrmHipsHeight / ( motionHipsHeight == 0 ? 1 : motionHipsHeight );

		const VRMRigMap = {
			"mixamo.com": mixamoVRMRigMap,
			"animation": bvhVRMRigMap,
			"Motion": motionVRMRigMap,
		}[ clip.name ];
		clip.tracks.forEach( ( track, i ) => {
			let trackName = track.name;
			if ( trackName.startsWith( "." ) ) {
				trackName = trackName.substring( 1 );
			}

			// Convert each tracks for VRM use, and push to `tracks`
			const trackSplitted = trackName.split( '.' );
			const mixamoRigName = trackSplitted[ 0 ];
			const vrmBoneName = VRMRigMap[ mixamoRigName ];
			const vrmNodeName = vrm.humanoid?.getNormalizedBoneNode( vrmBoneName )?.name;
			let mixamoRigNode;
			if ( typeof asset.getObjectByName !== "undefined" ) {
				mixamoRigNode = asset.getObjectByName( mixamoRigName );
			}

			if ( vrmNodeName != null ) {
				const propertyName = trackSplitted[ 1 ];

				// Store rotations of rest-pose.
				mixamoRigNode?.getWorldQuaternion( restRotationInverse ).invert();
				mixamoRigNode?.parent.getWorldQuaternion( parentRestWorldRotation );

				if ( track instanceof THREE.QuaternionKeyframeTrack ) {
					// Retarget rotation of mixamoRig to NormalizedBone.
					for ( let i = 0; i < track.values.length; i += 4 ) {
						const flatQuaternion = track.values.slice( i, i + 4 );

						_quatA.fromArray( flatQuaternion );

						// 親のレスト時ワールド回転 * トラックの回転 * レスト時ワールド回転の逆
						_quatA.premultiply( parentRestWorldRotation ).multiply( restRotationInverse );

						_quatA.toArray( flatQuaternion );

						flatQuaternion.forEach( ( v, index ) => {
							track.values[ index + i ] = v;
						} );
					}

					tracks.push(
						new THREE.QuaternionKeyframeTrack(
							`${vrmNodeName}.${propertyName}`,
							track.times.map( ( e ) => e / animationSpeed ),
							track.values.map( ( v, i ) => ( vrm.meta?.metaVersion === '0' && i % 2 === 0 ? - v : v ) ),
						),
					);
				} else if ( track instanceof THREE.VectorKeyframeTrack ) {
					const value = track.values.map(
						( v, i ) => ( vrm.meta?.metaVersion === '0' && i % 3 !== 1 ? - v : v ) * hipsPositionScale,
					);
					tracks.push( new THREE.VectorKeyframeTrack( `${vrmNodeName}.${propertyName}`, track.times, value ) );
				}
			}
		} );

		return new THREE.AnimationClip( 'vrmAnimation', clip.duration, tracks );
	} );
}
