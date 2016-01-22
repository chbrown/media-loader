/**
Helper function to create a new DOM element, using given tag and attributes.

Example usage:

    var video = E('video', {id: 'video_01', style: 'display: none'})
*/
function E(tagName: string, attributes: {[index: string]: string} = {}, children: Node[] = []) {
  let element = document.createElement(tagName);
  Object.keys(attributes).forEach(name => {
    element.setAttribute(name, attributes[name]);
  });
  children.forEach(child => {
    element.appendChild(child);
  });
  return element;
}

export type EventCallback = (...eventArgs: any[]) => void;
export class EventEmitter {
  eventListeners: {[index: string]: EventCallback[]} = {};
  addEventListener(type: string, listener: EventCallback) {
    if (this.eventListeners[type] === undefined) {
      this.eventListeners[type] = [];
    }
    this.eventListeners[type].push(listener);
  }
  removeEventListener(type: string, listener: EventCallback) {
    if (this.eventListeners[type] !== undefined) {
      this.eventListeners[type] = this.eventListeners[type].filter(eventListener => eventListener !== listener);
    }
  }
  protected emit(type: string, ...eventArgs: any[]) {
    if (this.eventListeners[type] !== undefined) {
      this.eventListeners[type].forEach(eventListener => {
        eventListener(...eventArgs);
      });
    }
  }
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  let length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function toArray(nodeList: NodeList) {
  var length = nodeList.length;
  var array = new Array(length);
  for (var index = 0; index < length; index++) {
    array[index] = nodeList[index];
  }
  return array;
}

function time(): number {
  return (new Date()).getTime();
}

function inferType(url: string) {
  if (/\.(mp4|m4v|mpg|webm)$/.test(url)) {
    return 'video';
  }
  else if (/\.(mp3|wav)$/.test(url)) {
    return 'audio';
  }
  else {
    return 'image';
  }
}

/** Timeout values in milliseconds */
export enum Timeouts {
  rush = 2000,
  zero = 5000,
  slow = 20000,
  hard = 50000,
};

const hiddenStyle = 'display: none';

/**
Resource: responsible for preloading a single resource.

Resources do not know about other resources -- they aren't chained.

Events:
* 'error': Emitted if the resource 404s or times out.
* 'progress': Emitted periodically while the resource is loading with the
  current ratio of progress (between 0 and 1). It may emit multiple 'progress'
  events with the same value.
* 'finish': Emitted when the resource has completed preloading and is ready to
  display. When this is emitted, resource.complete will be true.
*/
export class Resource extends EventEmitter {
  element: HTMLElement;
  complete = false;
  private startedTime: number;
  /**
  `type` should be one of 'video', 'audio', or 'image'
  `urls` should be a list of urls
  */
  constructor(public type: string, public urls: string[]) { super(); }
  abort() {
    if (this.element) {
      // only do the weird media cancellation hack for videos
      if (this.type === 'video') {
        toArray(this.element.children)
          .filter(element => element.tagName == 'source')
          .forEach(element => element.setAttribute('src', ''))
        var mediaElement: HTMLMediaElement = <any>this.element;
        if (mediaElement.load) mediaElement.load();
      }
      // abruptly and rudely remove the whole element from the dom.
      this.element.parentNode.removeChild(this.element);
      this.element = undefined;
      this.complete = false;
    }
  }
  private createElement() {
    if (this.type === 'video' || this.type === 'audio') {
      return E(this.type, {style: hiddenStyle, autobuffer: '', preload: 'auto'},
        this.urls.map(src => E('source', {src}))
      );
    }
    else if (this.type === 'image') {
      return E('div', {style: hiddenStyle},
        this.urls.map(src => E('img', {src}))
      );
    }
    else {
      return E('span', {style: hiddenStyle},
        [document.createTextNode(this.type)]
      );
    }
  }

  /**
  Return a value between 0 and 1 representing the portion of the resource that has completed loading.
  */
  private get completed(): number {
    if (this.type === 'image') {
      // element is a div, containing img's
      // let's just say that one complete image is enough
      for (var i = 0; i < this.element.children.length; i++) {
        const imgElement: HTMLImageElement = <any>this.element.children[i];
        if (imgElement.complete) {
          return 1;
        }
      }
    }
    else { // type == 'audio' || type == 'video'
      const mediaElement: HTMLMediaElement = <any>this.element;
      let bufferedLength = 0;
      if (mediaElement.buffered && mediaElement.buffered.length > 0) {
        bufferedLength = mediaElement.buffered.end(0);
      }
      // mediaElement.duration might be NaN, probably when it hasn't loaded yet
      const duration = mediaElement.duration;
      if (!isNaN(duration)) {
        return bufferedLength / duration;
      }
    }
    return 0;
  }

  private finish(error?: Error) {
    if (error) {
      this.emit('error', error);
    }
    else {
      this.complete = true;
      this.emit('finish');
    }
  }

  /** begin monitoring process, setting up a loop with variable timeout */
  private updateListeners(rush: boolean) {
    if (!this.element) {
      // type: 'ElementError'
      return this.finish(new Error('Resource aborted, element removed.'));
      // type: 'MediaError'
      // return finish(new Error('Media cannot be found for the url.'));
    }

    const completed = this.completed;
    const elapsedTime = time() - this.startedTime;
    this.emit('progress', completed);

    if (completed > 0.99) {
      // close enough, normal completion
      this.finish();
    }
    else if (rush) {
      if (elapsedTime > Timeouts.rush && completed > 0.5) { // && last_10_diff_sum < 1
        // sometimes Chrome doesn't feel like loading the whole video. Okay, fine.
        this.finish();
      }
      else {
        setTimeout(() => this.updateListeners(rush), 250);
      }
    }
    else if (elapsedTime > Timeouts.zero && completed > 0.5) { // && last_10_diff_sum < 1
      // it seems that Chrome isn't ever going to preload the whole media
      this.finish();
    }
    else if (elapsedTime > Timeouts.slow) { // && buffered_length === 0
      // simply can't find it all, probably a 404
      this.finish(new Error('Cannot find or load media.'));
    }
    else if (elapsedTime > Timeouts.slow) { //  && last_10_diff_sum < 0.01
      // give up
      this.finish();
    }
    else if (elapsedTime > Timeouts.hard) {
      this.finish();
    }
    else {
      setTimeout(() => this.updateListeners(rush), 250);
    }
  }

  equalTo({type, urls}: {type: string, urls: string[]}): boolean {
    return (this.type === type) && arraysEqual(this.urls, urls);
  }

  /**
  If rush == true, play as soon as we think we can manage it.
  */
  insert(container: HTMLElement, rush: boolean = false) {
    // keep track of the element in the resource so we can detach it later in abort if needed
    this.element = this.createElement();
    container.appendChild(this.element);
    // this.type = inferType(url); // one of 'video', 'audio', or 'image'
    this.startedTime = time();
    this.updateListeners(rush);
  }

  /** Call this when the resource finishes loading, or immediately, if it is
  already completely loaded.
  */
  ready(callback: (error?: Error) => void) {
    if (this.complete) {
      setTimeout(() => callback(), 0);
    }
    else {
      this.addEventListener('finish', callback);
    }
  }
}

/** new Preloader: create a new preloader helper, specifying where in the
DOM it should put loading elements.

Emits 'finish' events

`options`: Object
    `container`: DOM Element Node (optional)
    `logger`: logging object (optional)
    `urls`: List of urls to preload (optional)
    `paused`: initial state (defaults to true)
*/
export class Preloader extends EventEmitter {
  paused = true;
  resources: Resource[] = [];
  /** container may be null, but the default won't be created until one is needed */
  constructor(public verbose = false, public container: HTMLElement = undefined) { super(); }
  private getContainer(): HTMLElement {
    if (!this.container) {
      // if no container is provided, create new node at the end of the document to hold the elements.
      this.container = E('div', {style: hiddenStyle});
      document.body.appendChild(this.container);
    }
    return this.container;
  }
  setContainer(container: HTMLElement) {
    if (this.container) {
      // move over children from the current container to the new one
      while (this.container.firstChild) {
        container.appendChild(this.container.firstChild);
      }
    }
    this.container = container;
  }
  private log(message: string) {
    if (this.verbose) {
      console.log(message);
    }
  }
  /**
  Iterate through resources and return the first one that is not complete.
  The returned resource may not have even started.
  Returns undefined when all resources are completely loaded.
  */
  private getCurrentResource() {
    const incompleteResources = this.resources.filter(resource => !resource.complete);
    return incompleteResources[0];
  }
  /**
  If any of the already known resources match the given resource, return it.
  Otherwise, create a new resource and add it to the list of pending resources.
  */
  private findOrCreateResource({type, urls}: {type: string, urls: string[]}): Resource {
    const matchingResources = this.resources.filter(resource => resource.equalTo({type, urls}));
    if (matchingResources.length === 0) {
      const resource = new Resource(type, urls);
      this.resources.push(resource);
      return resource;
    }
    return matchingResources[0];
  }

  /** pause the preloader, but don't abort the current load */
  pause() {
    this.log('Preloader.pause()');
    this.paused = true;
  }
  /** pause the preloader and abort the current load */
  abort() {
    this.log('Preloader.abort()');
    // if we haven't loaded everything yet, find the current resource and abort it
    const currentResource = this.getCurrentResource();
    if (currentResource) currentResource.abort();
  }
  /** resume loading the pending resources */
  resume() {
    this.log(`Preloader.resume() (was previously ${this.paused ? 'paused' : 'not paused'})`);
    this.paused = false;
    this.loop();
  }

  /** this can be called multiple times without ill effect */
  loop() {
    this.log(`Preloader.loop() (currently ${this.paused ? 'paused' : 'not paused'})`);
    if (!this.paused) {
      const currentResource = this.getCurrentResource();
      if (currentResource) {
        if (currentResource.element) {
          this.log(`Preloader.loop (in-progress: ${currentResource.urls.join(', ')})`);
        }
        else {
          currentResource.insert(this.getContainer(), false);
          this.log(`Preloader.loop (inserted: ${currentResource.urls.join(', ')})`);
          currentResource.ready(error => {
            if (error) {
              this.log(`Resource error: ${error.toString()}`);
            }
            this.loop();
          });
        }
      }
      else {
        this.emit('finish');
        this.log('Preloader.loop (no more resources)');
      }
    }
  }

  /**
  Look for the resource with the given url in the
  existing resources, or add it if it does not already exist.

  If 'rush' is true, aborts the current loading resource if it isn't the one we want.
  */
  load(type: string, urls: string[], rush: boolean, callback: (error: Error, element?: HTMLElement) => void) {
    this.log(`Preloader.load(type="${type}", urls=[${urls.join(', ')}], rush=${rush}, <callback>)`);
    const currentResource = this.getCurrentResource();
    const resource = this.findOrCreateResource({type, urls});

    if (rush) {
      this.pause();
      // only abort the currently loading resource if it's not the one we want
      if (currentResource && currentResource !== resource) {
        currentResource.abort();
      }
    }

    if (!resource.element) {
      // rush: true
      resource.insert(this.getContainer(), rush);
    }
    resource.ready(error => {
      if (error) {
        this.log(`Resource error: ${error.toString()}`);
      }
      callback(error, resource.element);
    });
  }
}
