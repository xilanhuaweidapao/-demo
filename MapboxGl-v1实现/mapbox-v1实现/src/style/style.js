// @flow

import assert from 'assert';

import {Event, ErrorEvent, Evented} from '../util/evented';
import StyleLayer from './style_layer';
import createStyleLayer from './create_style_layer';
import loadSprite from './load_sprite';
import ImageManager from '../render/image_manager';
import GlyphManager from '../render/glyph_manager';
import Light from './light';
import LineAtlas from '../render/line_atlas';
import {pick, clone, extend, deepEqual, filterObject, mapObject} from '../util/util';
import {getJSON, getReferrer, makeRequest, ResourceType} from '../util/ajax';
import {isMapboxURL} from '../util/mapbox';
import browser from '../util/browser';
import Dispatcher from '../util/dispatcher';
import {validateStyle, emitValidationErrors as _emitValidationErrors} from './validate_style';
import {
    getType as getSourceType,
    setType as setSourceType,
    type SourceClass
} from '../source/source';
import {queryRenderedFeatures, queryRenderedSymbols, querySourceFeatures} from '../source/query_features';
import SourceCache from '../source/source_cache';
import GeoJSONSource from '../source/geojson_source';
import styleSpec from '../style-spec/reference/latest';
import getWorkerPool from '../util/global_worker_pool';
import deref from '../style-spec/deref';
import emptyStyle from '../style-spec/empty';
import diffStyles, {operations as diffOperations} from '../style-spec/diff';
import {
    registerForPluginStateChange,
    evented as rtlTextPluginEvented,
    triggerPluginCompletionEvent
} from '../source/rtl_text_plugin';
import PauseablePlacement from './pauseable_placement';
import ZoomHistory from './zoom_history';
import CrossTileSymbolIndex from '../symbol/cross_tile_symbol_index';
import {validateCustomStyleLayer} from './style_layer/custom_style_layer';

// We're skipping validation errors with the `source.canvas` identifier in order
// to continue to allow canvas sources to be added at runtime/updated in
// smart setStyle (see https://github.com/mapbox/mapbox-gl-js/pull/6424):
const emitValidationErrors = (evented: Evented, errors: ?$ReadOnlyArray<{message: string, identifier?: string}>) =>
    _emitValidationErrors(evented, errors && errors.filter(error => error.identifier !== 'source.canvas'));

import type Map from '../ui/map';
import type Transform from '../geo/transform';
import type {StyleImage} from './style_image';
import type {StyleGlyph} from './style_glyph';
import type {Callback} from '../types/callback';
import type EvaluationParameters from './evaluation_parameters';
import type {Placement} from '../symbol/placement';
import type {Cancelable} from '../types/cancelable';
import type {RequestParameters, ResponseCallback} from '../util/ajax';
import type {GeoJSON} from '@mapbox/geojson-types';
import type {
    LayerSpecification,
    FilterSpecification,
    StyleSpecification,
    LightSpecification,
    SourceSpecification
} from '../style-spec/types';
import type {CustomLayerInterface} from './style_layer/custom_style_layer';
import type {Validator} from './validate_style';
import type {OverscaledTileID} from '../source/tile_id';

const supportedDiffOperations = pick(diffOperations, [
    'addLayer',
    'removeLayer',
    'setPaintProperty',
    'setLayoutProperty',
    'setFilter',
    'addSource',
    'removeSource',
    'setLayerZoomRange',
    'setLight',
    'setTransition',
    'setGeoJSONSourceData'
    // 'setGlyphs',
    // 'setSprite',
]);

const ignoredDiffOperations = pick(diffOperations, [
    'setCenter',
    'setZoom',
    'setBearing',
    'setPitch'
]);

const empty = emptyStyle();

export type StyleOptions = {
    validate?: boolean,
    localIdeographFontFamily?: string
};

export type StyleSetterOptions = {
    validate?: boolean
};
/**
 * @private
 */
class Style extends Evented {
    map: Map;
    stylesheet: StyleSpecification;
    dispatcher: Dispatcher;
    imageManager: ImageManager;
    glyphManager: GlyphManager;
    lineAtlas: LineAtlas;
    light: Light;

    _request: ?Cancelable;
    _spriteRequest: ?Cancelable;
    _layers: {[_: string]: StyleLayer};
    _serializedLayers: {[_: string]: Object};
    _order: Array<string>;
    sourceCaches: {[_: string]: SourceCache};
    zoomHistory: ZoomHistory;
    _loaded: boolean;
    _rtlTextPluginCallback: Function;
    _changed: boolean;
    _updatedSources: {[_: string]: 'clear' | 'reload'};
    _updatedLayers: {[_: string]: true};
    _removedLayers: {[_: string]: StyleLayer};
    _changedImages: {[_: string]: true};
    _updatedPaintProps: {[layer: string]: true};
    _layerOrderChanged: boolean;
    _availableImages: Array<string>;

    crossTileSymbolIndex: CrossTileSymbolIndex;
    pauseablePlacement: PauseablePlacement;
    placement: Placement;
    z: number;

    // exposed to allow stubbing by unit tests
    static getSourceType: typeof getSourceType;
    static setSourceType: typeof setSourceType;
    static registerForPluginStateChange: typeof registerForPluginStateChange;

    constructor(map: Map, options: StyleOptions = {}) {
        super();

        this.map = map;
        this.dispatcher = new Dispatcher(getWorkerPool(), this);
        this.imageManager = new ImageManager();
        this.imageManager.setEventedParent(this);
        this.glyphManager = new GlyphManager(map._requestManager, options.localIdeographFontFamily);
        this.lineAtlas = new LineAtlas(256, 512);
        this.crossTileSymbolIndex = new CrossTileSymbolIndex();

        this._layers = {};
        this._serializedLayers = {};
        this._order  = [];
        this.sourceCaches = {};
        this.zoomHistory = new ZoomHistory();
        this._loaded = false;
        this._availableImages = [];

        this._resetUpdates();

        this.dispatcher.broadcast('setReferrer', getReferrer());

        const self = this;
        this._rtlTextPluginCallback = Style.registerForPluginStateChange((event) => {
            const state = {
                pluginStatus: event.pluginStatus,
                pluginURL: event.pluginURL
            };
            self.dispatcher.broadcast('syncRTLPluginState', state, (err, results) => {
                triggerPluginCompletionEvent(err);
                if (results) {
                    const allComplete = results.every((elem) => elem);
                    if (allComplete) {
                        for (const id in self.sourceCaches) {
                            self.sourceCaches[id].reload(); // Should be a no-op if the plugin loads before any tiles load
                        }
                    }
                }

            });
        });

        this.on('data', (event) => {
            if (event.dataType !== 'source' || event.sourceDataType !== 'metadata') {
                return;
            }

            const sourceCache = this.sourceCaches[event.sourceId];
            if (!sourceCache) {
                return;
            }

            const source = sourceCache.getSource();
            if (!source || !source.vectorLayerIds) {
                return;
            }

            for (const layerId in this._layers) {
                const layer = this._layers[layerId];
                if (layer.source === source.id) {
                    this._validateLayer(layer);
                }
            }
        });
    }

    loadURL(url: string, options: {
        validate?: boolean,
        accessToken?: string
    } = {}) {
        this.fire(new Event('dataloading', {dataType: 'style'}));

        const validate = typeof options.validate === 'boolean' ?
            options.validate : !isMapboxURL(url);

        url = this.map._requestManager.normalizeStyleURL(url, options.accessToken);
        const request = this.map._requestManager.transformRequest(url, ResourceType.Style);
        this._request = getJSON(request, (error: ?Error, json: ?Object) => {
            this._request = null;
            if (error) {
                this.fire(new ErrorEvent(error));
            } else if (json) {
                this._load(json, validate);
            }
        });
    }

    loadJSON(json: StyleSpecification, options: StyleSetterOptions = {}) {
        this.fire(new Event('dataloading', {dataType: 'style'}));

        this._request = browser.frame(() => {
            this._request = null;
            this._load(json, options.validate !== false);
        });
    }

    loadEmpty() {
        this.fire(new Event('dataloading', {dataType: 'style'}));
        this._load(empty, false);
    }

    _load(json: StyleSpecification, validate: boolean) {
        if (validate && emitValidationErrors(this, validateStyle(json))) {
            return;
        }

        this._loaded = true;
        this.stylesheet = json;

        for (const id in json.sources) {
            this.addSource(id, json.sources[id], {validate: false});
        }

        if (json.sprite) {
            this._loadSprite(json.sprite);
        } else {
            this.imageManager.setLoaded(true);
        }

        this.glyphManager.setURL(json.glyphs);

        const layers = deref(this.stylesheet.layers);

        this._order = layers.map((layer) => layer.id);

        this._layers = {};
        this._serializedLayers = {};
        for (let layer of layers) {
            layer = createStyleLayer(layer);
            layer.setEventedParent(this, {layer: {id: layer.id}});
            this._layers[layer.id] = layer;
            this._serializedLayers[layer.id] = layer.serialize();
        }
        this.dispatcher.broadcast('setLayers', this._serializeLayers(this._order));

        this.light = new Light(this.stylesheet.light);

        this.fire(new Event('data', {dataType: 'style'}));
        this.fire(new Event('style.load'));
    }

    _loadSprite(url: string) {
        this._spriteRequest = loadSprite(url, this.map._requestManager, (err, images) => {
            this._spriteRequest = null;
            if (err) {
                this.fire(new ErrorEvent(err));
            } else if (images) {
                for (const id in images) {
                    this.imageManager.addImage(id, images[id]);
                }
            }

            this.imageManager.setLoaded(true);
            this._availableImages = this.imageManager.listImages();
            this.dispatcher.broadcast('setImages', this._availableImages);
            this.fire(new Event('data', {dataType: 'style'}));
        });
    }

    _validateLayer(layer: StyleLayer) {
        const sourceCache = this.sourceCaches[layer.source];
        if (!sourceCache) {
            return;
        }

        const sourceLayer = layer.sourceLayer;
        if (!sourceLayer) {
            return;
        }

        const source = sourceCache.getSource();
        if (source.type === 'geojson' || (source.vectorLayerIds && source.vectorLayerIds.indexOf(sourceLayer) === -1)) {
            this.fire(new ErrorEvent(new Error(
                `Source layer "${sourceLayer}" ` +
                `does not exist on source "${source.id}" ` +
                `as specified by style layer "${layer.id}"`
            )));
        }
    }

    loaded() {
        if (!this._loaded)
            return false;

        if (Object.keys(this._updatedSources).length)
            return false;

        for (const id in this.sourceCaches)
            if (!this.sourceCaches[id].loaded())
                return false;

        if (!this.imageManager.isLoaded())
            return false;

        return true;
    }

    _serializeLayers(ids: Array<string>): Array<Object> {
        const serializedLayers = [];
        for (const id of ids) {
            const layer = this._layers[id];
            if (layer.type !== 'custom') {
                serializedLayers.push(layer.serialize());
            }
        }
        return serializedLayers;
    }

    hasTransitions() {
        if (this.light && this.light.hasTransition()) {
            return true;
        }

        for (const id in this.sourceCaches) {
            if (this.sourceCaches[id].hasTransition()) {
                return true;
            }
        }

        for (const id in this._layers) {
            if (this._layers[id].hasTransition()) {
                return true;
            }
        }

        return false;
    }

    _checkLoaded() {
        if (!this._loaded) {
            throw new Error('Style is not done loading');
        }
    }

    /**
     * Apply queued style updates in a batch and recalculate zoom-dependent paint properties.
     * @private
     */
    update(parameters: EvaluationParameters) {
        if (!this._loaded) {
            return;
        }

        const changed = this._changed;
        if (this._changed) {
            const updatedIds = Object.keys(this._updatedLayers);
            const removedIds = Object.keys(this._removedLayers);

            if (updatedIds.length || removedIds.length) {
                this._updateWorkerLayers(updatedIds, removedIds);
            }
            for (const id in this._updatedSources) {
                const action = this._updatedSources[id];
                assert(action === 'reload' || action === 'clear');
                if (action === 'reload') {
                    this._reloadSource(id);
                } else if (action === 'clear') {
                    this._clearSource(id);
                }
            }

            this._updateTilesForChangedImages();

            for (const id in this._updatedPaintProps) {
                this._layers[id].updateTransitions(parameters);
            }

            this.light.updateTransitions(parameters);

            this._resetUpdates();
        }

        for (const sourceId in this.sourceCaches) {
            this.sourceCaches[sourceId].used = false;
        }

        for (const layerId of this._order) {
            const layer = this._layers[layerId];

            layer.recalculate(parameters, this._availableImages);
            if (!layer.isHidden(parameters.zoom) && layer.source) {
                this.sourceCaches[layer.source].used = true;
            }
        }

        this.light.recalculate(parameters);
        this.z = parameters.zoom;

        if (changed) {
            this.fire(new Event('data', {dataType: 'style'}));
        }

    }

    /*
     * Apply any queued image changes.
     */
    _updateTilesForChangedImages() {
        const changedImages = Object.keys(this._changedImages);
        if (changedImages.length) {
            for (const name in this.sourceCaches) {
                this.sourceCaches[name].reloadTilesForDependencies(['icons', 'patterns'], changedImages);
            }
            this._changedImages = {};
        }
    }

    _updateWorkerLayers(updatedIds: Array<string>, removedIds: Array<string>) {
        this.dispatcher.broadcast('updateLayers', {
            layers: this._serializeLayers(updatedIds),
            removedIds
        });
    }

    _resetUpdates() {
        this._changed = false;

        this._updatedLayers = {};
        this._removedLayers = {};

        this._updatedSources = {};
        this._updatedPaintProps = {};

        this._changedImages = {};
    }

    /**
     * Update this style's state to match the given style JSON, performing only
     * the necessary mutations.
     *
     * May throw an Error ('Unimplemented: METHOD') if the mapbox-gl-style-spec
     * diff algorithm produces an operation that is not supported.
     *
     * @returns {boolean} true if any changes were made; false otherwise
     * @private
     */
    setState(nextState: StyleSpecification) {
        this._checkLoaded();

        if (emitValidationErrors(this, validateStyle(nextState))) return false;

        nextState = clone(nextState);
        nextState.layers = deref(nextState.layers);

        const changes = diffStyles(this.serialize(), nextState)
            .filter(op => !(op.command in ignoredDiffOperations));

        if (changes.length === 0) {
            return false;
        }

        const unimplementedOps = changes.filter(op => !(op.command in supportedDiffOperations));
        if (unimplementedOps.length > 0) {
            throw new Error(`Unimplemented: ${unimplementedOps.map(op => op.command).join(', ')}.`);
        }

        changes.forEach((op) => {
            if (op.command === 'setTransition') {
                // `transition` is always read directly off of
                // `this.stylesheet`, which we update below
                return;
            }
            (this: any)[op.command].apply(this, op.args);
        });

        this.stylesheet = nextState;

        return true;
    }

    addImage(id: string, image: StyleImage) {
        if (this.getImage(id)) {
            return this.fire(new ErrorEvent(new Error('An image with this name already exists.')));
        }
        this.imageManager.addImage(id, image);
        this._afterImageUpdated(id);
    }

    updateImage(id: string, image: StyleImage) {
        this.imageManager.updateImage(id, image);
    }

    getImage(id: string): ?StyleImage {
        return this.imageManager.getImage(id);
    }

    removeImage(id: string) {
        if (!this.getImage(id)) {
            return this.fire(new ErrorEvent(new Error('No image with this name exists.')));
        }
        this.imageManager.removeImage(id);
        this._afterImageUpdated(id);
    }

    _afterImageUpdated(id: string) {
        this._availableImages = this.imageManager.listImages();
        this._changedImages[id] = true;
        this._changed = true;
        this.dispatcher.broadcast('setImages', this._availableImages);
        this.fire(new Event('data', {dataType: 'style'}));
    }

    listImages() {
        this._checkLoaded();

        return this.imageManager.listImages();
    }

    addSource(id: string, source: SourceSpecification, options: StyleSetterOptions = {}) {
        this._checkLoaded();

        if (this.sourceCaches[id] !== undefined) {
            throw new Error('There is already a source with this ID');
        }

        if (!source.type) {
            throw new Error(`The type property must be defined, but only the following properties were given: ${Object.keys(source).join(', ')}.`);
        }

        const builtIns = ['vector', 'raster', 'geojson', 'video', 'image'];
        const shouldValidate = builtIns.indexOf(source.type) >= 0;
        if (shouldValidate && this._validate(validateStyle.source, `sources.${id}`, source, null, options)) return;

        if (this.map && this.map._collectResourceTiming) (source: any).collectResourceTiming = true;
        const sourceCache = this.sourceCaches[id] = new SourceCache(id, source, this.dispatcher);
        sourceCache.style = this;
        sourceCache.setEventedParent(this, () => ({
            isSourceLoaded: this.loaded(),
            source: sourceCache.serialize(),
            sourceId: id
        }));

        sourceCache.onAdd(this.map);
        this._changed = true;
    }

    /**
     * Remove a source from this stylesheet, given its id.
     * @param {string} id id of the source to remove
     * @throws {Error} if no source is found with the given ID
     * @returns {Map} The {@link Map} object.
     */
    removeSource(id: string) {
        this._checkLoaded();

        if (this.sourceCaches[id] === undefined) {
            throw new Error('There is no source with this ID');
        }
        for (const layerId in this._layers) {
            if (this._layers[layerId].source === id) {
                return this.fire(new ErrorEvent(new Error(`Source "${id}" cannot be removed while layer "${layerId}" is using it.`)));
            }
        }

        const sourceCache = this.sourceCaches[id];
        delete this.sourceCaches[id];
        delete this._updatedSources[id];
        sourceCache.fire(new Event('data', {sourceDataType: 'metadata', dataType:'source', sourceId: id}));
        sourceCache.setEventedParent(null);
        sourceCache.clearTiles();

        if (sourceCache.onRemove) sourceCache.onRemove(this.map);
        this._changed = true;
    }

    /**
    * Set the data of a GeoJSON source, given its id.
    * @param {string} id id of the source
    * @param {GeoJSON|string} data GeoJSON source
    */
    setGeoJSONSourceData(id: string, data: GeoJSON | string) {
        this._checkLoaded();

        assert(this.sourceCaches[id] !== undefined, 'There is no source with this ID');
        const geojsonSource: GeoJSONSource = (this.sourceCaches[id].getSource(): any);
        assert(geojsonSource.type === 'geojson');

        geojsonSource.setData(data);
        this._changed = true;
    }

    /**
     * Get a source by id.
     * @param {string} id id of the desired source
     * @returns {Object} source
     */
    getSource(id: string): Object {
        return this.sourceCaches[id] && this.sourceCaches[id].getSource();
    }

    /**
     * Add a layer to the map style. The layer will be inserted before the layer with
     * ID `before`, or appended if `before` is omitted.
     * @param {Object | CustomLayerInterface} layerObject The style layer to add.
     * @param {string} [before] ID of an existing layer to insert before
     * @param {Object} options Style setter options.
     * @returns {Map} The {@link Map} object.
     */
    addLayer(layerObject: LayerSpecification | CustomLayerInterface, before?: string, options: StyleSetterOptions = {}) {
        this._checkLoaded();

        const id = layerObject.id;

        if (this.getLayer(id)) {
            this.fire(new ErrorEvent(new Error(`Layer with id "${id}" already exists on this map`)));
            return;
        }

        let layer;
        if (layerObject.type === 'custom') {

            if (emitValidationErrors(this, validateCustomStyleLayer(layerObject))) return;

            layer = createStyleLayer(layerObject);

        } else {
            if (typeof layerObject.source === 'object') {
                this.addSource(id, layerObject.source);
                layerObject = clone(layerObject);
                layerObject = (extend(layerObject, {source: id}): any);
            }

            // this layer is not in the style.layers array, so we pass an impossible array index
            if (this._validate(validateStyle.layer,
                `layers.${id}`, layerObject, {arrayIndex: -1}, options)) return;

            layer = createStyleLayer(layerObject);
            this._validateLayer(layer);

            layer.setEventedParent(this, {layer: {id}});
            this._serializedLayers[layer.id] = layer.serialize();
        }

        const index = before ? this._order.indexOf(before) : this._order.length;
        if (before && index === -1) {
            this.fire(new ErrorEvent(new Error(`Layer with id "${before}" does not exist on this map.`)));
            return;
        }

        this._order.splice(index, 0, id);
        this._layerOrderChanged = true;

        this._layers[id] = layer;

        if (this._removedLayers[id] && layer.source && layer.type !== 'custom') {
            // If, in the current batch, we have already removed this layer
            // and we are now re-adding it with a different `type`, then we
            // need to clear (rather than just reload) the underyling source's
            // tiles.  Otherwise, tiles marked 'reloading' will have buckets /
            // buffers that are set up for the _previous_ version of this
            // layer, causing, e.g.:
            // https://github.com/mapbox/mapbox-gl-js/issues/3633
            const removed = this._removedLayers[id];
            delete this._removedLayers[id];
            if (removed.type !== layer.type) {
                this._updatedSources[layer.source] = 'clear';
            } else {
                this._updatedSources[layer.source] = 'reload';
                this.sourceCaches[layer.source].pause();
            }
        }
        this._updateLayer(layer);

        if (layer.onAdd) {
            layer.onAdd(this.map);
        }
    }

    /**
     * Return the style layer object with the given `id`.
     *
     * @param {string} id - id of the desired layer
     * @returns {?Object} a layer, if one with the given `id` exists
     */
    getLayer(id: string): Object {
        return this._layers[id];
    }

    /**
     * checks if a specific layer is present within the style.
     *
     * @param {string} id - id of the desired layer
     * @returns {boolean} a boolean specifying if the given layer is present
     */
    hasLayer(id: string): boolean {
        return id in this._layers;
    }

    setLayerZoomRange(layerId: string, minzoom: ?number, maxzoom: ?number) {
        this._checkLoaded();

        const layer = this.getLayer(layerId);
        if (!layer) {
            this.fire(new ErrorEvent(new Error(`The layer '${layerId}' does not exist in the map's style and cannot have zoom extent.`)));
            return;
        }

        if (layer.minzoom === minzoom && layer.maxzoom === maxzoom) return;

        if (minzoom != null) {
            layer.minzoom = minzoom;
        }
        if (maxzoom != null) {
            layer.maxzoom = maxzoom;
        }
        this._updateLayer(layer);
    }

    /**
     * Get a layer's filter object
     * @param {string} layer the layer to inspect
     * @returns {*} the layer's filter, if any
     */
    getFilter(layer: string) {
        return clone(this.getLayer(layer).filter);
    }

    getTransition() {
        return extend({duration: 300, delay: 0}, this.stylesheet && this.stylesheet.transition);
    }

    serialize() {
        return filterObject({
            version: this.stylesheet.version,
            name: this.stylesheet.name,
            metadata: this.stylesheet.metadata,
            light: this.stylesheet.light,
            center: this.stylesheet.center,
            zoom: this.stylesheet.zoom,
            bearing: this.stylesheet.bearing,
            pitch: this.stylesheet.pitch,
            sprite: this.stylesheet.sprite,
            glyphs: this.stylesheet.glyphs,
            transition: this.stylesheet.transition,
            sources: mapObject(this.sourceCaches, (source) => source.serialize()),
            layers: this._serializeLayers(this._order)
        }, (value) => { return value !== undefined; });
    }

    _updateLayer(layer: StyleLayer) {
        this._updatedLayers[layer.id] = true;
        if (layer.source && !this._updatedSources[layer.source] &&
            //Skip for raster layers (https://github.com/mapbox/mapbox-gl-js/issues/7865)
            this.sourceCaches[layer.source].getSource().type !== 'raster') {
            this._updatedSources[layer.source] = 'reload';
            this.sourceCaches[layer.source].pause();
        }
        this._changed = true;
    }

    _flattenAndSortRenderedFeatures(sourceResults: Array<any>) {
        // Feature order is complicated.
        // The order between features in two 2D layers is always determined by layer order.
        // The order between features in two 3D layers is always determined by depth.
        // The order between a feature in a 2D layer and a 3D layer is tricky:
        //      Most often layer order determines the feature order in this case. If
        //      a line layer is above a extrusion layer the line feature will be rendered
        //      above the extrusion. If the line layer is below the extrusion layer,
        //      it will be rendered below it.
        //
        //      There is a weird case though.
        //      You have layers in this order: extrusion_layer_a, line_layer, extrusion_layer_b
        //      Each layer has a feature that overlaps the other features.
        //      The feature in extrusion_layer_a is closer than the feature in extrusion_layer_b so it is rendered above.
        //      The feature in line_layer is rendered above extrusion_layer_a.
        //      This means that that the line_layer feature is above the extrusion_layer_b feature despite
        //      it being in an earlier layer.

        const isLayer3D = layerId => this._layers[layerId].type === 'fill-extrusion';

        const layerIndex = {};
        const features3D = [];
        for (let l = this._order.length - 1; l >= 0; l--) {
            const layerId = this._order[l];
            if (isLayer3D(layerId)) {
                layerIndex[layerId] = l;
                for (const sourceResult of sourceResults) {
                    const layerFeatures = sourceResult[layerId];
                    if (layerFeatures) {
                        for (const featureWrapper of layerFeatures) {
                            features3D.push(featureWrapper);
                        }
                    }
                }
            }
        }

        features3D.sort((a, b) => {
            return b.intersectionZ - a.intersectionZ;
        });

        const features = [];
        for (let l = this._order.length - 1; l >= 0; l--) {
            const layerId = this._order[l];

            if (isLayer3D(layerId)) {
                // add all 3D features that are in or above the current layer
                for (let i = features3D.length - 1; i >= 0; i--) {
                    const topmost3D = features3D[i].feature;
                    if (layerIndex[topmost3D.layer.id] < l) break;
                    features.push(topmost3D);
                    features3D.pop();
                }
            } else {
                for (const sourceResult of sourceResults) {
                    const layerFeatures = sourceResult[layerId];
                    if (layerFeatures) {
                        for (const featureWrapper of layerFeatures) {
                            features.push(featureWrapper.feature);
                        }
                    }
                }
            }
        }

        return features;
    }

    addSourceType(name: string, SourceType: SourceClass, callback: Callback<void>) {
        if (Style.getSourceType(name)) {
            return callback(new Error(`A source type called "${name}" already exists.`));
        }

        Style.setSourceType(name, SourceType);

        if (!SourceType.workerSourceURL) {
            return callback(null, null);
        }

        this.dispatcher.broadcast('loadWorkerSource', {
            name,
            url: SourceType.workerSourceURL
        }, callback);
    }

    getLight() {
        return this.light.getLight();
    }

    _validate(validate: Validator, key: string, value: any, props: any, options: { validate?: boolean } = {}) {
        if (options && options.validate === false) {
            return false;
        }
        return emitValidationErrors(this, validate.call(validateStyle, extend({
            key,
            style: this.serialize(),
            value,
            styleSpec
        }, props)));
    }

    _remove() {
        if (this._request) {
            this._request.cancel();
            this._request = null;
        }
        if (this._spriteRequest) {
            this._spriteRequest.cancel();
            this._spriteRequest = null;
        }
        rtlTextPluginEvented.off('pluginStateChange', this._rtlTextPluginCallback);
        for (const layerId in this._layers) {
            const layer: StyleLayer = this._layers[layerId];
            layer.setEventedParent(null);
        }
        for (const id in this.sourceCaches) {
            this.sourceCaches[id].clearTiles();
            this.sourceCaches[id].setEventedParent(null);
        }
        this.imageManager.setEventedParent(null);
        this.setEventedParent(null);
        this.dispatcher.remove();
    }

    _clearSource(id: string) {
        this.sourceCaches[id].clearTiles();
    }

    _reloadSource(id: string) {
        this.sourceCaches[id].resume();
        this.sourceCaches[id].reload();
    }

    _updateSources(transform: Transform) {
        for (const id in this.sourceCaches) {
            this.sourceCaches[id].update(transform);
        }
    }

    _generateCollisionBoxes() {
        for (const id in this.sourceCaches) {
            this._reloadSource(id);
        }
    }

    _updatePlacement(transform: Transform, showCollisionBoxes: boolean, fadeDuration: number, crossSourceCollisions: boolean, forceFullPlacement: boolean = false) {
        let symbolBucketsChanged = false;
        let placementCommitted = false;

        const layerTiles = {};

        for (const layerID of this._order) {
            const styleLayer = this._layers[layerID];
            if (styleLayer.type !== 'symbol') continue;

            if (!layerTiles[styleLayer.source]) {
                const sourceCache = this.sourceCaches[styleLayer.source];
                layerTiles[styleLayer.source] = sourceCache.getRenderableIds(true)
                    .map((id) => sourceCache.getTileByID(id))
                    .sort((a, b) => (b.tileID.overscaledZ - a.tileID.overscaledZ) || (a.tileID.isLessThan(b.tileID) ? -1 : 1));
            }

            const layerBucketsChanged = this.crossTileSymbolIndex.addLayer(styleLayer, layerTiles[styleLayer.source], transform.center.lng);
            symbolBucketsChanged = symbolBucketsChanged || layerBucketsChanged;
        }
        this.crossTileSymbolIndex.pruneUnusedLayers(this._order);

        // Anything that changes our "in progress" layer and tile indices requires us
        // to start over. When we start over, we do a full placement instead of incremental
        // to prevent starvation.
        // We need to restart placement to keep layer indices in sync.
        // Also force full placement when fadeDuration === 0 to ensure that newly loaded
        // tiles will fully display symbols in their first frame
        forceFullPlacement = forceFullPlacement || this._layerOrderChanged || fadeDuration === 0;

        if (forceFullPlacement || !this.pauseablePlacement || (this.pauseablePlacement.isDone() && !this.placement.stillRecent(browser.now(), transform.zoom))) {
            this.pauseablePlacement = new PauseablePlacement(transform, this._order, forceFullPlacement, showCollisionBoxes, fadeDuration, crossSourceCollisions, this.placement);
            this._layerOrderChanged = false;
        }

        if (this.pauseablePlacement.isDone()) {
            // the last placement finished running, but the next one hasn’t
            // started yet because of the `stillRecent` check immediately
            // above, so mark it stale to ensure that we request another
            // render frame
            this.placement.setStale();
        } else {
            this.pauseablePlacement.continuePlacement(this._order, this._layers, layerTiles);

            if (this.pauseablePlacement.isDone()) {
                this.placement = this.pauseablePlacement.commit(browser.now());
                placementCommitted = true;
            }

            if (symbolBucketsChanged) {
                // since the placement gets split over multiple frames it is possible
                // these buckets were processed before they were changed and so the
                // placement is already stale while it is in progress
                this.pauseablePlacement.placement.setStale();
            }
        }

        if (placementCommitted || symbolBucketsChanged) {
            for (const layerID of this._order) {
                const styleLayer = this._layers[layerID];
                if (styleLayer.type !== 'symbol') continue;
                this.placement.updateLayerOpacities(styleLayer, layerTiles[styleLayer.source]);
            }
        }

        // needsRender is false when we have just finished a placement that didn't change the visibility of any symbols
        const needsRerender = !this.pauseablePlacement.isDone() || this.placement.hasTransitions(browser.now());
        return needsRerender;
    }

    _releaseSymbolFadeTiles() {
        for (const id in this.sourceCaches) {
            this.sourceCaches[id].releaseSymbolFadeTiles();
        }
    }
}

Style.getSourceType = getSourceType;
Style.setSourceType = setSourceType;
Style.registerForPluginStateChange = registerForPluginStateChange;

export default Style;
