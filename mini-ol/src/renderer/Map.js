/**
 * @module ol/renderer/Map
 */
import Disposable from '../Disposable.js';
import {abstract} from '../util.js';
import {compose as composeTransform, makeInverse} from '../transform.js';
import {shared as iconImageCache} from '../style/IconImageCache.js';

/**
 * @typedef HitMatch
 * @property {import("../Feature.js").FeatureLike} feature Feature.
 * @property {import("../layer/Layer.js").default} layer Layer.
 * @property {import("../geom/SimpleGeometry.js").default} geometry Geometry.
 * @property {number} distanceSq Squared distance.
 * @property {import("./vector.js").FeatureCallback<T>} callback Callback.
 * @template T
 */

/**
 * @abstract
 */
class MapRenderer extends Disposable {
  /**
   * @param {import("../Map.js").default} map Map.
   */
  constructor(map) {
    super();

    /**
     * @private
     * @type {import("../Map.js").default}
     */
    this.map_ = map;
  }

  /**
   * @abstract
   * @param {import("../render/EventType.js").default} type Event type.
   * @param {import("../Map.js").FrameState} frameState Frame state.
   */
  dispatchRenderEvent(type, frameState) {
    abstract();
  }

  /**
   * @param {import("../Map.js").FrameState} frameState FrameState.
   * @protected
   */
  calculateMatrices2D(frameState) {
    const viewState = frameState.viewState;
    const coordinateToPixelTransform = frameState.coordinateToPixelTransform;
    const pixelToCoordinateTransform = frameState.pixelToCoordinateTransform;

    composeTransform(
      coordinateToPixelTransform,
      frameState.size[0] / 2, // 像素中心点
      frameState.size[1] / 2, // 像素中心点
      1 / viewState.resolution, // 3857 为例， 每米多少像素？
      -1 / viewState.resolution, // 3857 为例， 每米多少像素？
      -viewState.rotation,
      -viewState.center[0], // 地理中心点
      -viewState.center[1] // 地理中心点
    );
    // 逆矩阵的含义？ wdp?
    // 逆矩阵表示对变化状态的恢复
    makeInverse(pixelToCoordinateTransform, coordinateToPixelTransform);
  }

  /**
   * @return {import("../Map.js").default} Map.
   */
  getMap() {
    return this.map_;
  }

  /**
   * Render.
   * @abstract
   * @param {?import("../Map.js").FrameState} frameState Frame state.
   */
  renderFrame(frameState) {
    abstract();
  }

  /**
   * @param {import("../Map.js").FrameState} frameState Frame state.
   * @protected
   */
  scheduleExpireIconCache(frameState) {
    if (iconImageCache.canExpireCache()) {
      frameState.postRenderFunctions.push(expireIconCache);
    }
  }
}

/**
 * @param {import("../Map.js").default} map Map.
 * @param {import("../Map.js").FrameState} frameState Frame state.
 */
function expireIconCache(map, frameState) {
  iconImageCache.expire();
}

export default MapRenderer;
