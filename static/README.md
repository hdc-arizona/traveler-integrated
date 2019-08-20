Hacking the web app
===================
Everything in `static` should feel like a server-less ES6 web app, other than
the API calls + indirection in `index.html` to the ReDoc / Swagger
interfaces—there isn't any server-side template magic to worry about.

Things follow an MVC pattern using the
[uki](https://github.com/alex-r-bigelow/uki) framework, with things sorted into
`models` and `views` directories and a `controller.js` file. Since this is
@alex-r-bigelow's DIY framework, please don't hesitate to call him out if
something doesn't make sense / isn't documented properly.

For including javascript libraries in the page, we do something a little
weird—there's probably a better way to do this, but for now, `npm install` any
libraries you need into this directory, and then tweak `static/.gitignore` to
only include the files that you actually use (everything else in `node_modules`
will get ignored). In the event that something *isn't* on NPM, use the `utils`
directory (also a good place to drop general-purpose functions that you write;
at the moment, everything in there is a custom function that could be
generalized as an NPM package some day, snippets from StackOverflow, etc).

All of the stuff pertinent to a view should be in its directory, so things
*should* be relatively self-contained, though you should still do sensible
things like wrapping your styles in a view-specific selector to keep things from
interfering with one another (see any of the `.less` files for an example).
Also, we've tried to keep things like the interface-wide color palette defined
in a global LESS files (e.g. `style/colors.less`).
