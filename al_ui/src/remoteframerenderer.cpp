#include "remoteframerenderer.hpp"

RemoteFrameRenderer::RemoteFrameRenderer()
    : m_outPixel(1280 * 480 * 3), m_newFrame(false), m_width(0), m_height(0),
      m_updateSize(false) {}

int RemoteFrameRenderer::init() {
  // GL_CHECK_ERRORS
  // load the shader
  shader.LoadFromFile(GL_VERTEX_SHADER,
                      "../al_ui/shaders/videoStreamRenderer.vert");
  shader.LoadFromFile(GL_FRAGMENT_SHADER,
                      "../al_ui/shaders/videoStreamRenderer.frag");
  // compile and link shader
  shader.CreateAndLinkProgram();
  shader.Use();
  // add attributes and uniforms
  shader.AddAttribute("vVertex");
  shader.AddUniform("MVP");
  shader.AddUniform("textureMap");
  // pass values of constant uniforms at initialization
  glUniform1i(shader("textureMap"), 4);
  // pass values of constant uniforms at initialization
  shader.UnUse();

  // GL_CHECK_ERRORS

  // setup triangle geometry
  // setup triangle vertices
  vertices[0].color = glm::vec3(1, 0, 0);
  vertices[1].color = glm::vec3(0, 1, 0);
  vertices[2].color = glm::vec3(0, 0, 1);
  vertices[3].color = glm::vec3(0, 1, 1);

  vertices[0].position = glm::vec3(-0.5, -0.5, 0);
  vertices[1].position = glm::vec3(0.5, -0.5, 0);
  vertices[2].position = glm::vec3(0.5, 0.5, 0);
  vertices[3].position = glm::vec3(-0.5, 0.5, 0);

  // setup triangle indices
  indices[0] = 0;
  indices[1] = 1;
  indices[2] = 2;
  indices[3] = 0;
  indices[4] = 2;
  indices[5] = 3;

  // GL_CHECK_ERRORS

  // setup triangle vao and vbo stuff
  glGenVertexArrays(1, &vaoID);
  glGenBuffers(1, &vboVerticesID);
  glGenBuffers(1, &vboIndicesID);
  GLsizei stride = sizeof(Vertex);

  glBindVertexArray(vaoID);

  glBindBuffer(GL_ARRAY_BUFFER, vboVerticesID);
  // pass triangle verteices to buffer object
  glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), &vertices[0], GL_STATIC_DRAW);
  // GL_CHECK_ERRORS
  // enable vertex attribute array for position
  glEnableVertexAttribArray(shader["vVertex"]);
  glVertexAttribPointer(shader["vVertex"], 3, GL_FLOAT, GL_FALSE, stride, 0);
  // GL_CHECK_ERRORS
  // enable vertex attribute array for colour
  // glEnableVertexAttribArray(shader["vColor"]);
  // glVertexAttribPointer(shader["vColor"], 3, GL_FLOAT, GL_FALSE, stride,
  //                       (const GLvoid *)offsetof(Vertex, color));
  // GL_CHECK_ERRORS
  // pass indices to element array buffer
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, vboIndicesID);
  glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(indices), &indices[0],
               GL_STATIC_DRAW);
  // GL_CHECK_ERRORS

  // unbinding
  glBindVertexArray(0);
  glBindBuffer(GL_ARRAY_BUFFER, 0);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);

  // some tex ==============
  glGenTextures(1, &sensorDepthTexID);
  glActiveTexture(GL_TEXTURE4);
  glBindTexture(GL_TEXTURE_2D, sensorDepthTexID);
  // set texture parameters
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP);
  glBindTexture(GL_TEXTURE_2D, 0);
  // =====================
  // initFBO();

  // m_sensorDataFboRenderer.init();
  cout << "Initialization successfull" << endl;
  return 1;
}

void RemoteFrameRenderer::render(int viewWidh, int viewHeight) {
  // // ============ FBO ==============
  // // enable FBO
  // glBindFramebuffer(GL_FRAMEBUFFER, fboID);
  // // render to colour attachment 0
  // glDrawBuffer(GL_COLOR_ATTACHMENT0);
  // // clear the colour and depth buffers
  // glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  // // clear the colour and depth buffer
  // // ============ ~FBO ==============

  // // [AL-153] Getting pixels to bitmap
  // if (sendingFrames) {
  //   glReadPixels(0, 0, 1280, 480, GL_RGB, GL_UNSIGNED_BYTE,
  //   &(m_outPixel[0]));
  //   newFrameSignal(m_outPixel, 1280, 480);
  // }
  if (m_updateSize) {
  }
  if (m_newFrame) {
    m_remoteFrameMtx.lock();
    glActiveTexture(GL_TEXTURE4);
    glBindTexture(GL_TEXTURE_2D, sensorDepthTexID);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, m_width, m_height, 0, GL_BGRA,
                 GL_UNSIGNED_BYTE, &(m_remoteFrame[0]));
    m_remoteFrameMtx.unlock();
  }
  // // ============ FBO ==============
  // // unbind the FBO
  // glBindFramebuffer(GL_FRAMEBUFFER, 0);
  // // restore the default back buffer
  // glDrawBuffer(GL_BACK_LEFT);
  // // bind the FBO output at the current texture
  // glActiveTexture(GL_TEXTURE3);
  // glBindTexture(GL_TEXTURE_2D, renderTextureID);
  // // ============ ~FBO ==============

  // glViewport(0, 0, viewWidh, viewHeight);

  glBindVertexArray(vaoID);
  glBindBuffer(GL_ARRAY_BUFFER, vboVerticesID);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, vboIndicesID);

  // bind the shader
  shader.Use();

  // pass the shader uniform
  glUniformMatrix4fv(shader("MVP"), 1, GL_FALSE, glm::value_ptr(P * MV));

  // draw triangle
  glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_SHORT, 0);
  // unbind the shader
  shader.UnUse();

  glBindVertexArray(0);
  glBindBuffer(GL_ARRAY_BUFFER, 0);
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);

  // seems to be needed by something, otherwise some artifacts appears
  glActiveTexture(GL_TEXTURE0);
}

// // initialize FBO
// void RemoteFrameRenderer::initFBO() {
//   // generate and bind fbo ID
//   glGenFramebuffers(1, &fboID);
//   glBindFramebuffer(GL_FRAMEBUFFER, fboID);
//
//   // generate and bind render buffer ID
//   glGenRenderbuffers(1, &rbID);
//   glBindRenderbuffer(GL_RENDERBUFFER, rbID);
//
//   // set the render buffer storage
//   glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT32, WIDTH,
//   HEIGHT);
//
//   // generate the offscreen texture
//   glGenTextures(1, &renderTextureID);
//   glBindTexture(GL_TEXTURE_2D, renderTextureID);
//
//   // set texture parameters
//   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
//   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
//   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
//   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
//   glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, WIDTH, HEIGHT, 0, GL_BGRA,
//                GL_UNSIGNED_BYTE, NULL);
//
//   // bind the renderTextureID as colour attachment of FBO
//   glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
//                          renderTextureID, 0);
//   // set the render buffer as the depth attachment of FBO
//   glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT,
//                             GL_RENDERBUFFER, rbID);
//
//   // check for frame buffer completeness status
//   GLuint status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
//
//   if (status == GL_FRAMEBUFFER_COMPLETE) {
//     printf("FBO setup succeededa.\n");
//   } else {
//     printf("Error in FBO setup.\n");
//   }
//
//   // unbind the texture and FBO
//   glBindTexture(GL_TEXTURE_2D, 0);
//   glBindFramebuffer(GL_FRAMEBUFFER, 0);
// }

void RemoteFrameRenderer::updateRemoteFrame(const uint8_t *image, int width,
                                            int height) {
  boost::lock_guard<boost::mutex> guard(m_remoteFrameMtx);
  if (m_width != width || m_height != height) {
    m_width = width;
    m_height = height;
    m_remoteFrame.resize(width * height * 4);
    m_updateSize = true;
  }
  std::copy(image, image + width * height * 4, m_remoteFrame.begin());
  m_newFrame = true;
}
