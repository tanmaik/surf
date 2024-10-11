document.addEventListener("DOMContentLoaded", function () {
  const createGroupBtn = document.getElementById("createGroup");
  const joinGroupBtn = document.getElementById("joinGroup");
  const groupIdInput = document.getElementById("groupId");
  const statusDiv = document.getElementById("status");

  createGroupBtn.addEventListener("click", function () {
    chrome.runtime.sendMessage({ action: "createGroup" }, function (response) {
      console.log("response", response);
      if (response.success) {
        statusDiv.textContent = `Group created! Code: ${response.listenerId}`;
      } else {
        statusDiv.textContent = "Failed to create group.";
      }
    });
  });

  joinGroupBtn.addEventListener("click", function () {
    const groupId = groupIdInput.value.trim();
    if (groupId) {
      chrome.runtime.sendMessage(
        { action: "joinGroup", groupId: groupId },
        function (response) {
          if (response.success) {
            statusDiv.textContent = `Joined group: ${groupId}`;
          } else {
            statusDiv.textContent = "Failed to join group.";
          }
        }
      );
    } else {
      statusDiv.textContent = "Please enter a group code.";
    }
  });
});
