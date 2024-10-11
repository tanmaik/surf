const SERVER_URL = "wss://surf-extension-server-a00e951e54e9.herokuapp.com";
// const SERVER_URL = "ws://localhost:3000";
let webSocket = null;

let listenerId = null;
let localState = { tabs: [] };

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action == "createGroup") {
    createGroup().then(sendResponse);
    return true;
  } else if (request.action == "joinGroup") {
    joinGroup(request.groupId).then(sendResponse);
    return true;
  }
});

function keepAlive() {
  const keepAliveIntervalId = setInterval(() => {
    if (webSocket) {
      webSocket.send(JSON.stringify({ type: "keepalive" }));
    } else {
      clearInterval(keepAliveIntervalId);
    }
  }, 20 * 1000);
}

function sendMessage(message) {
  if (webSocket && webSocket.readyState == WebSocket.OPEN) {
    webSocket.send(JSON.stringify(message));
  } else {
    console.error("WebSocket is not open. Unable to send message.");
  }
}

function connect() {
  webSocket = new WebSocket(SERVER_URL);

  webSocket.onopen = (event) => {
    console.log("websocket open");
    keepAlive();
  };

  webSocket.onmessage = async (message) => {
    const data = JSON.parse(message.data);
    console.log("websocket receive message", message);
    console.log("websocket receive data", data);

    if (data.type == "keepalive") {
      return;
    }
    if (data.listenerId != listenerId) {
      console.log("Listener ID doesn't match for me, ignoring message.");
      return;
    }

    chrome.tabs.onUpdated.removeListener(handleUpdate);
    console.log("Listener deactivated");

    switch (data.type) {
      case "group_joined":
        console.log("group joined");
        console.log("replacing first tab");
        console.log("listenerId", listenerId);
        const firstTab = await chrome.tabs.query({
          groupId: parseInt(listenerId),
        });
        let count = 0;
        console.log("the next line is the server tab");
        console.log(data.group.tabs[0]);
        localState.tabs.push({
          clientId: firstTab.id,
          url: data.group.tabs[0].url,
          serverId: data.group.tabs[0].id,
        });
        await chrome.tabs.update(firstTab.id, {
          url: data.group.tabs[0].url,
        });

        count = count + 1;
        console.log("count", count);
        console.log("group length", data.group.tabs.length);
        for (let i = 1; i < data.group.tabs.length; i++) {
          const serverTab = data.group.tabs[i];
          localState.tabs.push({
            clientId: (
              await chrome.tabs.create({
                url: serverTab.url,
              })
            ).id,
            url: serverTab.url,
            serverId: serverTab.id,
          });
          await chrome.tabs.group({
            tabIds: [
              localState.tabs.find((t) => t.serverId == serverTab.id).clientId,
            ],
            groupId: parseInt(listenerId),
          });

          count = count + 1;
          console.log("count", count);
        }
        console.log("group joined done");
        console.log("local state after group joined", localState);
        // if any part of the localState doesn't have a serverId or a clientId, then remove it from local state
        localState.tabs = localState.tabs.filter(
          (t) => t.serverId && t.clientId
        );
        console.log(
          "local state after removing tabs without serverId or clientId",
          localState
        );
        // wait for a couple seconds for the tabs to be created and then reactivate the listener

        break;
      case "group_created":
        for (const tab of data.group.tabs) {
          localState.tabs.find((t) => t.url == tab.url).serverId = tab.id;
        }
        break;
      case "tab_added":
        localState.tabs.find((t) => t.clientId == data.clientId).serverId =
          data.tab.id;
        console.log("Tab reinforced with server id", data.tab.id);
        break;
      case "tab_added_by_other":
        localState.tabs.push({
          clientId: (
            await chrome.tabs.create({
              url: data.tab.url,
            })
          ).id,
          url: data.tab.url,
          serverId: data.tab.id,
        });
        await chrome.tabs.group({
          tabIds: [
            localState.tabs.find((t) => t.serverId == data.tab.id).clientId,
          ],
          groupId: parseInt(listenerId),
        });

        break;
      case "tab_updated_by_other":
        console.log("tab updated by other");
        localState.tabs.find((t) => t.serverId == data.tab.id).url =
          data.tab.url;
        console.log(
          "updating tab",
          localState.tabs.find((t) => t.serverId == data.tab.id).clientId
        );
        await chrome.tabs.update(
          localState.tabs.find((t) => t.serverId == data.tab.id).clientId,
          {
            url: data.tab.url,
          }
        );
        break;
      case "tab_removed_by_other":
        const tab = localState.tabs.find((t) => t.serverId == data.tab.id);
        localState.tabs = localState.tabs.filter(
          (t) => t.serverId != data.tab.id
        );
        await chrome.tabs.remove(tab.clientId);
        break;
      default:
        break;
    }

    // Wait for a couple of seconds before reactivating the listener
    setTimeout(() => {
      chrome.tabs.onUpdated.addListener(handleUpdate);
      console.log("Listener reactivated with timeout");
    }, 3000);
  };

  webSocket.onclose = (event) => {
    console.log("websocket connection closed");
    webSocket = null;
  };
}

function disconnect() {
  if (webSocket == null) {
    return;
  }
  webSocket.close();
}

async function createGroup() {
  chrome.tabs.onUpdated.removeListener(handleUpdate);
  console.log("Listener deactivated");
  const tabs = await chrome.tabs.query({ currentWindow: true });
  listenerId = await chrome.tabs.group({ tabIds: tabs.map((t) => t.id) });
  listenerId = listenerId.toString();

  sendMessage({
    type: "create_group",
    tabs: tabs.map((t) => ({ url: t.url })),
    listenerId: listenerId,
  });

  for (const tab of tabs) {
    localState.tabs.push({
      serverId: null,
      clientId: tab.id,
      url: tab.url,
    });
  }

  return { success: true, listenerId: listenerId };
}

async function joinGroup(groupId) {
  chrome.tabs.onUpdated.removeListener(handleUpdate);
  console.log("Listener deactivated");
  const tabs = await chrome.tabs.query({ currentWindow: true });
  listenerId = await chrome.tabs.group({ tabIds: tabs[0].id });
  listenerId = listenerId.toString();

  sendMessage({
    type: "join_group",
    groupId: groupId,
    listenerId: listenerId,
  });

  return { success: true, listenerId: listenerId };
}

connect();

async function handleUpdate(tabId, changeInfo, tab) {
  if (changeInfo.status && !changeInfo.url) {
    console.log("tab status changing, ignoring");
    return;
  }

  const existingTab = localState.tabs.find((t) => t.clientId == tabId);

  if (existingTab) {
    if (existingTab.url == tab.url && tab.groupId == listenerId) {
      console.log(
        "Tab is the same so not going through update procedure, probably just loading or favicon."
      );
      return;
    }
  }

  if (tab.groupId == listenerId) {
    if (existingTab) {
      if (tab.url.includes("chrome-extension://")) {
        console.log("Tab is a chrome extension, ignoring.");
        return;
      }
      console.log(
        "Tab exists, but the url has actually change, so sending update to server."
      );
      existingTab.url = tab.url;
      sendMessage({
        type: "update_tab",
        tab: {
          url: tab.url,
          serverId: existingTab.serverId,
        },
        listenerId: listenerId,
      });
      console.log("New local state is:");
      console.log(localState.tabs);
    } else {
      console.log(
        "Tab doesn't exist in local or server, so we're adding it and sending update to server. The tab that is being added is:"
      );

      sendMessage({
        type: "add_tab",
        tab: {
          url: tab.url,
        },
        listenerId: listenerId,
        clientId: tabId,
      });
      localState.tabs.push({
        clientId: tabId,
        url: tab.url,
      });
      console.log("New local state is:");
      console.log(localState.tabs);
    }
  } else if (tab.groupId != listenerId) {
    console.log("Tab that was updated is not being listened.");
    if (existingTab) {
      console.log(
        "Tab that was updated to be in the group so we're removing it now, sending update to server."
      );
      const serverId = existingTab.serverId;

      localState.tabs = localState.tabs.filter((t) => t.clientId != tabId);
      console.log("New local state is:");
      console.log(localState.tabs);
      sendMessage({
        type: "remove_tab",
        tabId: serverId,
        listenerId: listenerId,
      });
    } else {
      console.log(
        "Tab doesn't exist in local or server, so it doesn't matter."
      );
      return;
    }
  }
}
