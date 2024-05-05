// @flow

import {
    bindAll,
    extend,
    warnOnce,
    clamp,
    wrap,
    ease as defaultEasing,
    pick
} from '../util/util';
import {number as interpolate} from '../style-spec/util/interpolate';
import browser from '../util/browser';
import LngLat from '../geo/lng_lat';
import LngLatBounds from '../geo/lng_lat_bounds';
import Point from '@mapbox/point-geometry';
import {Event, Evented} from '../util/evented';
import assert from 'assert';
import {Debug} from '../util/debug';

import type Transform from '../geo/transform';
import type {LngLatLike} from '../geo/lng_lat';
import type {LngLatBoundsLike} from '../geo/lng_lat_bounds';
import type {TaskID} from '../util/task_queue';
import type {PointLike} from '@mapbox/point-geometry';
import type {PaddingOptions} from '../geo/edge_insets';

/**
 * Options common to {@link Map#jumpTo}, {@link Map#easeTo}, and {@link Map#flyTo}, controlling the desired location,
 * zoom, bearing, and pitch of the camera. All properties are optional, and when a property is omitted, the current
 * camera value for that property will remain unchanged.
 *
 * @typedef {Object} CameraOptions
 * @property {LngLatLike} center The desired center.
 * @property {number} zoom The desired zoom level.
 * @property {number} bearing The desired bearing in degrees. The bearing is the compass direction that
 * is "up". For example, `bearing: 90` orients the map so that east is up.
 * @property {number} pitch The desired pitch in degrees. The pitch is the angle towards the horizon
 * measured in degrees with a range between 0 and 60 degrees. For example, pitch: 0 provides the appearance
 * of looking straight down at the map, while pitch: 60 tilts the user's perspective towards the horizon.
 * Increasing the pitch value is often used to display 3D objects.
 * @property {LngLatLike} around If `zoom` is specified, `around` determines the point around which the zoom is centered.
 * @property {PaddingOptions} padding Dimensions in pixels applied on each side of the viewport for shifting the vanishing point.
 * @example
 * // set the map's initial perspective with CameraOptions
 * var map = new mapboxgl.Map({
 *   container: 'map',
 *   style: 'mapbox://styles/mapbox/streets-v11',
 *   center: [-73.5804, 45.53483],
 *   pitch: 60,
 *   bearing: -60,
 *   zoom: 10
 * });
 * @see [Set pitch and bearing](https://docs.mapbox.com/mapbox-gl-js/example/set-perspective/)
 * @see [Jump to a series of locations](https://docs.mapbox.com/mapbox-gl-js/example/jump-to/)
 * @see [Fly to a location](https://docs.mapbox.com/mapbox-gl-js/example/flyto/)
 * @see [Display buildings in 3D](https://docs.mapbox.com/mapbox-gl-js/example/3d-buildings/)
 */
export type CameraOptions = {
    center?: LngLatLike,
    zoom?: number,
    bearing?: number,
    pitch?: number,
    around?: LngLatLike,
    padding?: PaddingOptions
};

/**
 * Options common to map movement methods that involve animation, such as {@link Map#panBy} and
 * {@link Map#easeTo}, controlling the duration and easing function of the animation. All properties
 * are optional.
 *
 * @typedef {Object} AnimationOptions
 * @property {number} duration The animation's duration, measured in milliseconds.
 * @property {Function} easing A function taking a time in the range 0..1 and returning a number where 0 is
 *   the initial state and 1 is the final state.
 * @property {PointLike} offset of the target center relative to real map container center at the end of animation.
 * @property {boolean} animate If `false`, no animation will occur.
 * @property {boolean} essential If `true`, then the animation is considered essential and will not be affected by
 *   [`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion).
 */
export type AnimationOptions = {
    duration?: number,
    easing?: (_: number) => number,
    offset?: PointLike,
    animate?: boolean,
    essential?: boolean
};

/**
 * Options for setting padding on calls to methods such as {@link Map#fitBounds}, {@link Map#fitScreenCoordinates}, and {@link Map#setPadding}. Adjust these options to set the amount of padding in pixels added to the edges of the canvas. Set a uniform padding on all edges or individual values for each edge. All properties of this object must be
 * non-negative integers.
 *
 * @typedef {Object} PaddingOptions
 * @property {number} top Padding in pixels from the top of the map canvas.
 * @property {number} bottom Padding in pixels from the bottom of the map canvas.
 * @property {number} left Padding in pixels from the left of the map canvas.
 * @property {number} right Padding in pixels from the right of the map canvas.
 *
 * @example
 * var bbox = [[-79, 43], [-73, 45]];
 * map.fitBounds(bbox, {
 *   padding: {top: 10, bottom:25, left: 15, right: 5}
 * });
 *
 * @example
 * var bbox = [[-79, 43], [-73, 45]];
 * map.fitBounds(bbox, {
 *   padding: 20
 * });
 * @see [Fit to the bounds of a LineString](https://docs.mapbox.com/mapbox-gl-js/example/zoomto-linestring/)
 * @see [Fit a map to a bounding box](https://docs.mapbox.com/mapbox-gl-js/example/fitbounds/)
 */

class Camera extends Evented {
    transform: Transform;
    _moving: boolean;
    _zooming: boolean;
    _rotating: boolean;
    _pitching: boolean;
    _padding: boolean;

    _bearingSnap: number;
    _easeStart: number;
    _easeOptions: {duration: number, easing: (_: number) => number};
    _easeId: string | void;

    _onEaseFrame: (_: number) => void;
    _onEaseEnd: (easeId?: string) => void;
    _easeFrameId: ?TaskID;

    +_requestRenderFrame: (() => void) => TaskID;
    +_cancelRenderFrame: (_: TaskID) => void;

    constructor(transform: Transform, options: {bearingSnap: number}) {
        super();
        this._moving = false;
        this._zooming = false;
        this.transform = transform;
        this._bearingSnap = options.bearingSnap;

        bindAll(['_renderFrameCallback'], this);

        //addAssertions(this);
    }

    /**
     * Returns the map's geographical centerpoint.
     *
     * @memberof Map#
     * @returns The map's geographical centerpoint.
     * @example
     * // return a LngLat object such as {lng: 0, lat: 0}
     * var center = map.getCenter();
     * // access longitude and latitude values directly
     * var {longitude, latitude} = map.getCenter();
     * @see Tutorial: [Use Mapbox GL JS in a React app](https://docs.mapbox.com/help/tutorials/use-mapbox-gl-js-with-react/#store-the-new-coordinates)
     */
    getCenter(): LngLat { return new LngLat(this.transform.center.lng, this.transform.center.lat); }


    /**
     * Returns the map's current zoom level.
     *
     * @memberof Map#
     * @returns The map's current zoom level.
     * @example
     * map.getZoom();
     */
    getZoom(): number { return this.transform.zoom; }

    /**
     * Returns the map's current bearing. The bearing is the compass direction that is "up"; for example, a bearing
     * of 90° orients the map so that east is up.
     *
     * @memberof Map#
     * @returns The map's current bearing.
     * @see [Navigate the map with game-like controls](https://www.mapbox.com/mapbox-gl-js/example/game-controls/)
     */
    getBearing(): number { return this.transform.bearing; }

    /**
     * Returns the current padding applied around the map viewport.
     *
     * @memberof Map#
     * @returns The current padding around the map viewport.
     */
    getPadding(): PaddingOptions { return this.transform.padding; }

    /**
     * Returns the map's current pitch (tilt).
     *
     * @memberof Map#
     * @returns The map's current pitch, measured in degrees away from the plane of the screen.
     */
    getPitch(): number { return this.transform.pitch; }

    /**
     * Changes any combination of center, zoom, bearing, and pitch, without
     * an animated transition. The map will retain its current values for any
     * details not specified in `options`.
     *
     * @memberof Map#
     * @param options Options object
     * @param eventData Additional properties to be added to event objects of events triggered by this method.
     * @fires movestart
     * @fires zoomstart
     * @fires pitchstart
     * @fires rotate
     * @fires move
     * @fires zoom
     * @fires pitch
     * @fires moveend
     * @fires zoomend
     * @fires pitchend
     * @returns {Map} `this`
     * @example
     * // jump to coordinates at current zoom
     * map.jumpTo({center: [0, 0]});
     * // jump with zoom, pitch, and bearing options
     * map.jumpTo({
     *   center: [0, 0],
     *   zoom: 8,
     *   pitch: 45,
     *   bearing: 90
     * });
     * @see [Jump to a series of locations](https://docs.mapbox.com/mapbox-gl-js/example/jump-to/)
     * @see [Update a feature in realtime](https://docs.mapbox.com/mapbox-gl-js/example/live-update-feature/)
     */
    jumpTo(options: CameraOptions, eventData?: Object) {
        this.stop();

        const tr = this.transform;
        let zoomChanged = false,
            bearingChanged = false,
            pitchChanged = false;

        if ('zoom' in options && tr.zoom !== +options.zoom) {
            zoomChanged = true;
            tr.zoom = +options.zoom;
        }

        if (options.center !== undefined) {
            tr.center = LngLat.convert(options.center);
        }

        if ('bearing' in options && tr.bearing !== +options.bearing) {
            bearingChanged = true;
            tr.bearing = +options.bearing;
        }

        if ('pitch' in options && tr.pitch !== +options.pitch) {
            pitchChanged = true;
            tr.pitch = +options.pitch;
        }

        if (options.padding != null && !tr.isPaddingEqual(options.padding)) {
            tr.padding = options.padding;
        }

        this.fire(new Event('movestart', eventData))
            .fire(new Event('move', eventData));

        if (zoomChanged) {
            this.fire(new Event('zoomstart', eventData))
                .fire(new Event('zoom', eventData))
                .fire(new Event('zoomend', eventData));
        }

        if (bearingChanged) {
            this.fire(new Event('rotatestart', eventData))
                .fire(new Event('rotate', eventData))
                .fire(new Event('rotateend', eventData));
        }

        if (pitchChanged) {
            this.fire(new Event('pitchstart', eventData))
                .fire(new Event('pitch', eventData))
                .fire(new Event('pitchend', eventData));
        }

        return this.fire(new Event('moveend', eventData));
    }

     /**
     * Rotates the map so that north is up (0° bearing), with an animated transition.
     *
     * @memberof Map#
     * @param options Options object
     * @param eventData Additional properties to be added to event objects of events triggered by this method.
     * @fires movestart
     * @fires moveend
     * @returns {Map} `this`
     */
     resetNorth(options?: AnimationOptions, eventData?: Object) {
      this.rotateTo(0, extend({duration: 1000}, options), eventData);
      return this;
    }

    /**
     * Rotates and pitches the map so that north is up (0° bearing) and pitch is 0°, with an animated transition.
     *
     * @memberof Map#
     * @param options Options object
     * @param eventData Additional properties to be added to event objects of events triggered by this method.
     * @fires movestart
     * @fires moveend
     * @returns {Map} `this`
     */
    resetNorthPitch(options?: AnimationOptions, eventData?: Object) {
        this.easeTo(extend({
            bearing: 0,
            pitch: 0,
            duration: 1000
        }, options), eventData);
        return this;
    }

    /**
     * Changes any combination of `center`, `zoom`, `bearing`, `pitch`, and `padding` with an animated transition
     * between old and new values. The map will retain its current values for any
     * details not specified in `options`.
     *
     * Note: The transition will happen instantly if the user has enabled
     * the `reduced motion` accesibility feature enabled in their operating system,
     * unless `options` includes `essential: true`.
     *
     * @memberof Map#
     * @param options Options describing the destination and animation of the transition.
     *            Accepts {@link CameraOptions} and {@link AnimationOptions}.
     * @param eventData Additional properties to be added to event objects of events triggered by this method.
     * @fires movestart
     * @fires zoomstart
     * @fires pitchstart
     * @fires rotate
     * @fires move
     * @fires zoom
     * @fires pitch
     * @fires moveend
     * @fires zoomend
     * @fires pitchend
     * @returns {Map} `this`
     * @see [Navigate the map with game-like controls](https://www.mapbox.com/mapbox-gl-js/example/game-controls/)
     */
    easeTo(options: CameraOptions & AnimationOptions & {easeId?: string}, eventData?: Object) {
        this._stop(false, options.easeId);

        options = extend({
            offset: [0, 0],
            duration: 500,
            easing: defaultEasing
        }, options);

        if (options.animate === false || (!options.essential && browser.prefersReducedMotion)) options.duration = 0;

        const tr = this.transform,
            startZoom = this.getZoom(),
            startBearing = this.getBearing(),
            startPitch = this.getPitch(),
            startPadding = this.getPadding(),

            zoom = 'zoom' in options ? +options.zoom : startZoom,
            bearing = 'bearing' in options ? this._normalizeBearing(options.bearing, startBearing) : startBearing,
            pitch = 'pitch' in options ? +options.pitch : startPitch,
            padding = 'padding' in options ? options.padding : tr.padding;

        const offsetAsPoint = Point.convert(options.offset);
        let pointAtOffset = tr.centerPoint.add(offsetAsPoint);
        const locationAtOffset = tr.pointLocation(pointAtOffset);
        const center = LngLat.convert(options.center || locationAtOffset);
        this._normalizeCenter(center);

        const from = tr.project(locationAtOffset);
        const delta = tr.project(center).sub(from);
        const finalScale = tr.zoomScale(zoom - startZoom);

        let around, aroundPoint;

        if (options.around) {
            around = LngLat.convert(options.around);
            aroundPoint = tr.locationPoint(around);
        }

        const currently = {
            moving: this._moving,
            zooming: this._zooming,
            rotating: this._rotating,
            pitching: this._pitching
        };

        this._zooming = this._zooming || (zoom !== startZoom);
        this._rotating = this._rotating || (startBearing !== bearing);
        this._pitching = this._pitching || (pitch !== startPitch);
        this._padding = !tr.isPaddingEqual(padding);

        this._easeId = options.easeId;
        this._prepareEase(eventData, options.noMoveStart, currently);

        this._ease((k) => {
            if (this._zooming) {
                tr.zoom = interpolate(startZoom, zoom, k);
            }
            if (this._rotating) {
                tr.bearing = interpolate(startBearing, bearing, k);
            }
            if (this._pitching) {
                tr.pitch = interpolate(startPitch, pitch, k);
            }
            if (this._padding) {
                tr.interpolatePadding(startPadding, padding, k);
                // When padding is being applied, Transform#centerPoint is changing continously,
                // thus we need to recalculate offsetPoint every fra,e
                pointAtOffset = tr.centerPoint.add(offsetAsPoint);
            }

            if (around) {
                tr.setLocationAtPoint(around, aroundPoint);
            } else {
                const scale = tr.zoomScale(tr.zoom - startZoom);
                const base = zoom > startZoom ?
                    Math.min(2, finalScale) :
                    Math.max(0.5, finalScale);
                const speedup = Math.pow(base, 1 - k);
                const newCenter = tr.unproject(from.add(delta.mult(k * speedup)).mult(scale));
                tr.setLocationAtPoint(tr.renderWorldCopies ? newCenter.wrap() : newCenter, pointAtOffset);
            }

            this._fireMoveEvents(eventData);

        }, (interruptingEaseId?: string) => {
            this._afterEase(eventData, interruptingEaseId);
        }, options);

        return this;
    }

    _prepareEase(eventData?: Object, noMoveStart: boolean, currently: Object = {}) {
        this._moving = true;

        if (!noMoveStart && !currently.moving) {
            this.fire(new Event('movestart', eventData));
        }
        if (this._zooming && !currently.zooming) {
            this.fire(new Event('zoomstart', eventData));
        }
        if (this._rotating && !currently.rotating) {
            this.fire(new Event('rotatestart', eventData));
        }
        if (this._pitching && !currently.pitching) {
            this.fire(new Event('pitchstart', eventData));
        }
    }

    _fireMoveEvents(eventData?: Object) {
        this.fire(new Event('move', eventData));
        if (this._zooming) {
            this.fire(new Event('zoom', eventData));
        }
        if (this._rotating) {
            this.fire(new Event('rotate', eventData));
        }
        if (this._pitching) {
            this.fire(new Event('pitch', eventData));
        }
    }

    _afterEase(eventData?: Object, easeId?: string) {
        // if this easing is being stopped to start another easing with
        // the same id then don't fire any events to avoid extra start/stop events
        if (this._easeId && easeId && this._easeId === easeId) {
            return;
        }
        delete this._easeId;

        const wasZooming = this._zooming;
        const wasRotating = this._rotating;
        const wasPitching = this._pitching;
        this._moving = false;
        this._zooming = false;
        this._rotating = false;
        this._pitching = false;
        this._padding = false;

        if (wasZooming) {
            this.fire(new Event('zoomend', eventData));
        }
        if (wasRotating) {
            this.fire(new Event('rotateend', eventData));
        }
        if (wasPitching) {
            this.fire(new Event('pitchend', eventData));
        }
        this.fire(new Event('moveend', eventData));
    }

    isEasing() {
        return !!this._easeFrameId;
    }

    /**
     * Stops any animated transition underway.
     *
     * @memberof Map#
     * @returns {Map} `this`
     */
    stop(): this {
        return this._stop();
    }

    _stop(allowGestures?: boolean, easeId?: string): this {
        if (this._easeFrameId) {
            this._cancelRenderFrame(this._easeFrameId);
            delete this._easeFrameId;
            delete this._onEaseFrame;
        }

        if (this._onEaseEnd) {
            // The _onEaseEnd function might emit events which trigger new
            // animation, which sets a new _onEaseEnd. Ensure we don't delete
            // it unintentionally.
            const onEaseEnd = this._onEaseEnd;
            delete this._onEaseEnd;
            onEaseEnd.call(this, easeId);
        }
        if (!allowGestures) {
            const handlers = (this: any).handlers;
            if (handlers) handlers.stop(false);
        }
        return this;
    }

    _ease(frame: (_: number) => void,
          finish: () => void,
          options: {animate: boolean, duration: number, easing: (_: number) => number}) {
        if (options.animate === false || options.duration === 0) {
            frame(1);
            finish();
        } else {
            this._easeStart = browser.now();
            this._easeOptions = options;
            this._onEaseFrame = frame;
            this._onEaseEnd = finish;
            this._easeFrameId = this._requestRenderFrame(this._renderFrameCallback);
        }
    }

    // Callback for map._requestRenderFrame
    _renderFrameCallback() {
        const t = Math.min((browser.now() - this._easeStart) / this._easeOptions.duration, 1);
        this._onEaseFrame(this._easeOptions.easing(t));
        if (t < 1) {
            this._easeFrameId = this._requestRenderFrame(this._renderFrameCallback);
        } else {
            this.stop();
        }
    }

    // convert bearing so that it's numerically close to the current one so that it interpolates properly
    _normalizeBearing(bearing: number, currentBearing: number) {
        bearing = wrap(bearing, -180, 180);
        const diff = Math.abs(bearing - currentBearing);
        if (Math.abs(bearing - 360 - currentBearing) < diff) bearing -= 360;
        if (Math.abs(bearing + 360 - currentBearing) < diff) bearing += 360;
        return bearing;
    }

    // If a path crossing the antimeridian would be shorter, extend the final coordinate so that
    // interpolating between the two endpoints will cross it.
    _normalizeCenter(center: LngLat) {
        const tr = this.transform;
        if (!tr.renderWorldCopies || tr.lngRange) return;

        const delta = center.lng - tr.center.lng;
        center.lng +=
            delta > 180 ? -360 :
            delta < -180 ? 360 : 0;
    }
}

// In debug builds, check that camera change events are fired in the correct order.
// - ___start events needs to be fired before ___ and ___end events
// - another ___start event can't be fired before a ___end event has been fired for the previous one
function addAssertions(camera: Camera) { //eslint-disable-line
    Debug.run(() => {
        const inProgress = {};

        ['drag', 'zoom', 'rotate', 'pitch', 'move'].forEach(name => {
            inProgress[name] = false;

            camera.on(`${name}start`, () => {
                assert(!inProgress[name], `"${name}start" fired twice without a "${name}end"`);
                inProgress[name] = true;
                assert(inProgress.move);
            });

            camera.on(name, () => {
                assert(inProgress[name]);
                assert(inProgress.move);
            });

            camera.on(`${name}end`, () => {
                assert(inProgress.move);
                assert(inProgress[name]);
                inProgress[name] = false;
            });
        });

        // Canary used to test whether this function is stripped in prod build
        canary = 'canary debug run';
    });
}

let canary; //eslint-disable-line

export default Camera;
