// @flow

import {collisionUniforms, collisionCircleUniforms} from './collision_program';
import {clippingMaskUniforms} from './clipping_mask_program';
import {rasterUniforms} from './raster_program';

export const programUniforms = {
    collisionBox: collisionUniforms,
    collisionCircle: collisionCircleUniforms,
    clippingMask: clippingMaskUniforms,
    raster: rasterUniforms,
};
