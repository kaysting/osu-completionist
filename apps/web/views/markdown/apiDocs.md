# osu!complete API Documentation

Thanks for showing interest in integrating osu!complete into your own projects! The goal of this API is to expose just the right amount of data so that developers like you can build amazing tools and visualizations around the completion data we collect here.

Please note that this API is in beta and breaking changes may be applied at any time. A best effort will be made to keep this documentation up to date, and to announce changes on the Discord server linked in the top bar.

## Base URL

All endpoints are available under the base URL:

```
https://osucomplete.org/api/v1
```

## Authentication

All endpoints require an API key to be provided using Bearer format in the Authorization header:

```
Authorization: Bearer YOUR_API_KEY
```

<% if (key) { %>

Below is the API key for your account. You can copy and regenerate it from here, but note that regenerating the key will immediately invalidate your previous one, stopping any existing services from working until you update them.

<div class="card lighter padded flex gap-8 flex-wrap" style="width: fit-content">
    <div class="textbox" style="width: 300px">
        <input type="text" class="input" value="<%= key %>" disabled>
    </div>
    <div class="flex gap-8">
        <button class="btn primary" onClick="copyText('<%= key %>')">
            <span class="icon">content_copy</span>
            <span class="label">Copy</span>
        </button>
        <a class="btn" href="/api/regenerate">
            <span class="icon">refresh</span>
            <span class="label">Regenerate</span>
        </a>
    </div>
</div>

<% } else { %>

You can view your API key here once you [sign in](/auth/login).

<% } %>

## Responses

All endpoints respond with valid JSON, regardless of success state. The global boolean `success` and object `error` response properties can be used to quickly detect and diagnose errors.

## Example request

Below is an example of the API in action. Here, we use JavaScript's `fetch` function to request a user's profile and output their username.

```javascript
const res = await fetch(`https://osucomplete.org/api/v1/users/22737645/profile`, {
    method: 'GET',
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer aea40b6ee734324ae988aa1c35537e0f` // <- replace this string with your key
    }
});
const json = await res.json();
console.log(`Fetched user profile for ${json.user.username}`);
```

---

## Endpoints

<% for (const endpoint of endpoints) { %>

### <%= endpoint.name %>

<%= endpoint.description %>

#### `<%= endpoint.method.toUpperCase() %>` `<%= endpoint.path %>`

    <% for (const type of ['url', 'query', 'body']) { %>
        <% if (endpoint.params[type]) { %>

#### <%= { url: 'Path', query: 'Query string', body: 'JSON body' }[type] %> parameters

            <% for (const param of endpoint.params[type]) { %>

**<%= param.required ? 'Required' : 'Optional' %> <%= param.type %> `<%= param.name %>`**  
<%= param.description || '' %>

            <% } %>
        <% } %>
    <% } %>

#### Successful response

    <% for (const property of endpoint.onSuccess) { %>

**<%= property.type %> `<%= property.name %>`**  
<%= property.description || '' %>

    <% } %>

#### Unsuccessful response

    <% for (const property of endpoint.onError) { %>

**<%= property.type %> `<%= property.name %>`**  
<%= property.description || '' %>

    <% } %>

<% } %>

---

## Object Structures

<% for (const struct of structs) { %>

### <%= struct.name %>

<%= struct.description %>

    <% for (const property of struct.properties) { %>

**<%= property.type %> `<%= property.name %>`**  
<%= property.description || '' %>

    <% } %>

<% } %>
